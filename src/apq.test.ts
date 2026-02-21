/**
 * APQ (Automatic Persisted Queries) Tests
 *
 * Tests for:
 * - LRU cache functionality and bounded memory
 * - Hash computation
 * - APQ protocol flow (hash-only, registration, retry)
 * - Error handling (network, HTTP, parse errors)
 * - Retry limits
 */

import { describe, it, expect, beforeEach, afterAll, vi, type Mock } from 'vitest'
import {
  ApqExecutionError,
  buildApqHashOnlyRequest,
  buildApqRegisterRequest,
  clearRegisteredHashes,
  computeQueryHash,
  executeWithApq,
  getCacheStats,
  isHashRegistered,
  isPersistedQueryNotFound,
  markHashAsRegistered,
} from './apq'

// Mock fetch globally
const mockFetch = vi.fn() as Mock

// Store original fetch
const originalFetch = globalThis.fetch

beforeEach(() => {
  // Reset all mocks and cache before each test
  vi.clearAllMocks()
  clearRegisteredHashes()
  globalThis.fetch = mockFetch
})

// Restore fetch after all tests
afterAll(() => {
  globalThis.fetch = originalFetch
})

describe('LRU Cache', () => {
  it('should start with empty cache', () => {
    const stats = getCacheStats()
    expect(stats.size).toBe(0)
    expect(stats.maxSize).toBe(1000)
  })

  it('should register hashes correctly', () => {
    markHashAsRegistered('hash1')
    markHashAsRegistered('hash2')

    expect(isHashRegistered('hash1')).toBe(true)
    expect(isHashRegistered('hash2')).toBe(true)
    expect(isHashRegistered('hash3')).toBe(false)

    const stats = getCacheStats()
    expect(stats.size).toBe(2)
  })

  it('should clear hashes correctly', () => {
    markHashAsRegistered('hash1')
    markHashAsRegistered('hash2')

    clearRegisteredHashes()

    expect(isHashRegistered('hash1')).toBe(false)
    expect(isHashRegistered('hash2')).toBe(false)

    const stats = getCacheStats()
    expect(stats.size).toBe(0)
  })
})

describe('computeQueryHash', () => {
  it('should compute consistent SHA-256 hash', async () => {
    const query = 'query GetUsers { users { id name } }'
    const hash1 = await computeQueryHash(query)
    const hash2 = await computeQueryHash(query)

    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/) // SHA-256 produces 64 hex chars
  })

  it('should produce different hashes for different queries', async () => {
    const hash1 = await computeQueryHash('query A { a }')
    const hash2 = await computeQueryHash('query B { b }')

    expect(hash1).not.toBe(hash2)
  })
})

describe('isPersistedQueryNotFound', () => {
  it('should detect PERSISTED_QUERY_NOT_FOUND error code', () => {
    const response = {
      errors: [
        {
          message: 'Query not found',
          extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' },
        },
      ],
    }

    expect(isPersistedQueryNotFound(response)).toBe(true)
  })

  it('should detect PersistedQueryNotFound message', () => {
    const response = {
      errors: [{ message: 'PersistedQueryNotFound' }],
    }

    expect(isPersistedQueryNotFound(response)).toBe(true)
  })

  it('should return false for other errors', () => {
    const response = {
      errors: [{ message: 'Some other error' }],
    }

    expect(isPersistedQueryNotFound(response)).toBe(false)
  })

  it('should return false for no errors', () => {
    expect(isPersistedQueryNotFound({ data: {} })).toBe(false)
    expect(isPersistedQueryNotFound({ data: {}, errors: [] })).toBe(false)
  })
})

describe('buildApqHashOnlyRequest', () => {
  it('should build request with hash only', () => {
    const request = buildApqHashOnlyRequest('abc123')

    expect(request).toEqual({
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: 'abc123',
        },
      },
    })
  })

  it('should include variables when provided', () => {
    const request = buildApqHashOnlyRequest('abc123', { id: '1' })

    expect(request).toEqual({
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: 'abc123',
        },
      },
      variables: { id: '1' },
    })
  })
})

describe('buildApqRegisterRequest', () => {
  it('should build request with query and hash', () => {
    const query = 'query { users }'
    const request = buildApqRegisterRequest(query, 'abc123')

    expect(request).toEqual({
      query: 'query { users }',
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: 'abc123',
        },
      },
    })
  })

  it('should include variables when provided', () => {
    const query = 'query ($id: ID!) { user(id: $id) }'
    const request = buildApqRegisterRequest(query, 'abc123', { id: '1' })

    expect(request).toEqual({
      query,
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: 'abc123',
        },
      },
      variables: { id: '1' },
    })
  })
})

describe('executeWithApq', () => {
  const endpoint = 'https://api.example.com/graphql'
  const query = 'query GetUsers { users { id } }'
  const fetchOptions: RequestInit = { credentials: 'include' }

  it('should use cached hash on subsequent requests', async () => {
    // First request: hash not found, register
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [
            { message: 'not found', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { users: [] } }),
      })

    await executeWithApq(endpoint, query, undefined, fetchOptions)

    // Second request: should use cached hash
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { users: [{ id: '1' }] } }),
    })

    const result = await executeWithApq(endpoint, query, undefined, fetchOptions)

    expect(result).toEqual({ users: [{ id: '1' }] })
    // First request: 2 calls (hash-only + register), Second request: 1 call (hash-only)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('should handle cache hit on first request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { users: [] } }),
    })

    const onMetric = vi.fn()
    await executeWithApq(endpoint, query, undefined, fetchOptions, onMetric)

    // Should record a hit since server had the query
    expect(onMetric).toHaveBeenCalledWith('graphql.apq.hit', 1, expect.any(Object))
  })

  it('should handle cache miss and register', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [{ extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { users: [] } }),
      })

    const onMetric = vi.fn()
    await executeWithApq(endpoint, query, undefined, fetchOptions, onMetric)

    // Should record a miss
    expect(onMetric).toHaveBeenCalledWith('graphql.apq.miss', 1, expect.any(Object))
  })

  it('should throw ApqExecutionError on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'))

    await expect(
      executeWithApq(endpoint, query, undefined, fetchOptions)
    ).rejects.toThrow(ApqExecutionError)

    await expect(
      executeWithApq(endpoint, query, undefined, fetchOptions)
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })

  it('should throw ApqExecutionError on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    await expect(
      executeWithApq(endpoint, query, undefined, fetchOptions)
    ).rejects.toThrow(ApqExecutionError)

    await expect(
      executeWithApq(endpoint, query, undefined, fetchOptions)
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    })
  })

  it('should throw ApqExecutionError on JSON parse error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('Invalid JSON')
      },
    })

    await expect(
      executeWithApq(endpoint, query, undefined, fetchOptions)
    ).rejects.toThrow(ApqExecutionError)

    await expect(
      executeWithApq(endpoint, query, undefined, fetchOptions)
    ).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    })
  })

  it('should throw on GraphQL errors', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        errors: [{ message: 'Field not found', extensions: { code: 'FIELD_ERROR' } }],
      }),
    })

    await expect(
      executeWithApq(endpoint, query, undefined, fetchOptions)
    ).rejects.toThrow(ApqExecutionError)

    await expect(
      executeWithApq(endpoint, query, undefined, fetchOptions)
    ).rejects.toMatchObject({
      code: 'FIELD_ERROR',
    })
  })

  it('should eventually fail when server never accepts query', async () => {
    // When server persistently returns PERSISTED_QUERY_NOT_FOUND even for
    // registration requests, we should eventually fail with an error
    // rather than looping forever.

    let callCount = 0
    mockFetch.mockImplementation(async () => {
      callCount++
      return {
        ok: true,
        json: async () => ({
          errors: [{ extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }],
        }),
      }
    })

    await expect(
      executeWithApq(endpoint, query, undefined, fetchOptions)
    ).rejects.toThrow(ApqExecutionError)

    // Should have made exactly 2 calls:
    // 1. Hash-only request (NOT_FOUND)
    // 2. Registration request (also NOT_FOUND, throws error)
    expect(callCount).toBe(2)
  })
})

describe('ApqExecutionError', () => {
  it('should preserve error context', () => {
    const cause = new Error('Original error')
    const error = new ApqExecutionError(
      'Test error',
      'TEST_CODE',
      'abc12345',
      cause
    )

    expect(error.message).toBe('Test error')
    expect(error.code).toBe('TEST_CODE')
    expect(error.operationHash).toBe('abc12345')
    expect(error.cause).toBe(cause)
    expect(error.name).toBe('ApqExecutionError')
  })
})
