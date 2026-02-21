/**
 * Automatic Persisted Queries (APQ) Support
 *
 * APQ reduces payload size by allowing clients to send query hashes instead
 * of full query documents. The server maintains a cache of hash → query mappings.
 *
 * Protocol:
 * 1. Client sends: { extensions: { persistedQuery: { sha256Hash: "abc...", version: 1 } } }
 *    (no query field)
 * 2a. Cache HIT: Server uses cached query, executes normally
 * 2b. Cache MISS: Server returns PersistedQueryNotFound error
 * 3. Client retries with full query:
 *    { query: "...", extensions: { persistedQuery: { sha256Hash: "abc...", version: 1 } } }
 * 4. Server caches query, executes normally
 */

import type { ApqError, GraphQLResponse } from './types'

// =============================================================================
// LRU Cache Implementation
// =============================================================================

/**
 * Simple LRU (Least Recently Used) cache with bounded size.
 * Prevents unbounded memory growth from registered hashes.
 */
class LRUCache<K, V> {
  private readonly maxSize: number
  private readonly cache: Map<K, V>

  constructor(maxSize: number) {
    this.maxSize = maxSize
    this.cache = new Map()
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    // Delete first if exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, value)
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }

  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// =============================================================================
// APQ Configuration
// =============================================================================

/** Maximum number of registered hashes to keep in memory */
const MAX_REGISTERED_HASHES = 1000

/** Maximum retry attempts for APQ re-registration */
const MAX_APQ_RETRIES = 2

/** Cache of query hashes that have been registered with the server */
const registeredHashes = new LRUCache<string, boolean>(MAX_REGISTERED_HASHES)

// =============================================================================
// Error Types
// =============================================================================

/**
 * Custom error class for APQ-specific errors with context
 */
export class ApqExecutionError extends Error {
  readonly code: string
  readonly operationHash: string
  readonly cause?: unknown

  constructor(
    message: string,
    code: string,
    operationHash: string,
    cause?: unknown
  ) {
    super(message)
    this.name = 'ApqExecutionError'
    this.code = code
    this.operationHash = operationHash
    this.cause = cause
  }
}

// =============================================================================
// Core APQ Functions
// =============================================================================

/**
 * Compute SHA-256 hash of a query string
 * Uses Web Crypto API for proper SHA-256
 */
export async function computeQueryHash(query: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(query)

  // Use Web Crypto API for SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Check if a response contains APQ "not found" error
 */
export function isPersistedQueryNotFound(response: GraphQLResponse): boolean {
  if (!response.errors || response.errors.length === 0) {
    return false
  }

  return response.errors.some(
    (error: ApqError) =>
      error.extensions?.code === 'PERSISTED_QUERY_NOT_FOUND' ||
      error.message === 'PersistedQueryNotFound'
  )
}

/**
 * Build request body for APQ (hash only, no query)
 */
export function buildApqHashOnlyRequest<TVariables>(
  hash: string,
  variables?: TVariables
): {
  extensions: { persistedQuery: { version: number; sha256Hash: string } }
  variables?: TVariables
} {
  return {
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: hash,
      },
    },
    ...(variables && { variables }),
  }
}

/**
 * Build request body for APQ registration (full query + hash)
 */
export function buildApqRegisterRequest<TVariables>(
  query: string,
  hash: string,
  variables?: TVariables
): {
  query: string
  extensions: { persistedQuery: { version: number; sha256Hash: string } }
  variables?: TVariables
} {
  return {
    query,
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: hash,
      },
    },
    ...(variables && { variables }),
  }
}

/**
 * Check if a query hash has been registered with the server
 */
export function isHashRegistered(hash: string): boolean {
  return registeredHashes.get(hash) === true
}

/**
 * Mark a query hash as registered with the server
 */
export function markHashAsRegistered(hash: string): void {
  registeredHashes.set(hash, true)
}

/**
 * Clear registered hashes (useful for testing)
 */
export function clearRegisteredHashes(): void {
  registeredHashes.clear()
}

/**
 * Get current cache statistics (for metrics/debugging)
 */
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: registeredHashes.size,
    maxSize: MAX_REGISTERED_HASHES,
  }
}

// =============================================================================
// HTTP Helpers
// =============================================================================

/**
 * Execute fetch with proper error handling and status validation
 */
async function executeFetch<TData>(
  endpoint: string,
  body: unknown,
  fetchOptions: RequestInit,
  hash: string
): Promise<GraphQLResponse<TData>> {
  let response: Response

  try {
    response = await fetch(endpoint, {
      ...fetchOptions,
      method: 'POST',
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new ApqExecutionError(
      `Network error during APQ request: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'NETWORK_ERROR',
      hash.substring(0, 8),
      error
    )
  }

  // Validate HTTP status before parsing
  if (!response.ok) {
    throw new ApqExecutionError(
      `HTTP error ${response.status}: ${response.statusText}`,
      'HTTP_ERROR',
      hash.substring(0, 8)
    )
  }

  // Parse JSON response
  let result: GraphQLResponse<TData>
  try {
    result = (await response.json()) as GraphQLResponse<TData>
  } catch (error) {
    throw new ApqExecutionError(
      'Failed to parse GraphQL response as JSON',
      'PARSE_ERROR',
      hash.substring(0, 8),
      error
    )
  }

  return result
}

/**
 * Extract and throw GraphQL errors with context
 */
function throwIfGraphQLError(
  result: GraphQLResponse<unknown>,
  hash: string,
  context: string
): void {
  const firstError = result.errors?.[0]
  if (firstError) {
    throw new ApqExecutionError(
      `GraphQL error (${context}): ${firstError.message}`,
      firstError.extensions?.code ?? 'GRAPHQL_ERROR',
      hash.substring(0, 8)
    )
  }
}

// =============================================================================
// APQ Request Executor
// =============================================================================

/**
 * APQ request executor
 *
 * Handles the full APQ protocol:
 * 1. If hash is already registered, send hash only
 * 2. If not registered, send hash only first
 * 3. If server returns PersistedQueryNotFound, retry with full query
 * 4. Cache the hash as registered
 *
 * Features:
 * - LRU cache prevents unbounded memory growth
 * - Bounded retry attempts prevent infinite loops
 * - Proper error handling with context
 * - HTTP status validation before JSON parsing
 */
export async function executeWithApq<
  TData,
  TVariables extends Record<string, unknown>,
>(
  endpoint: string,
  query: string,
  variables: TVariables | undefined,
  fetchOptions: RequestInit,
  onMetric?: (
    name: string,
    value: number,
    properties?: Record<string, unknown>
  ) => void,
  retryCount = 0
): Promise<TData> {
  const hash = await computeQueryHash(query)

  // If hash is registered, we know server has it - send hash only
  if (isHashRegistered(hash)) {
    const body = buildApqHashOnlyRequest(hash, variables)
    const result = await executeFetch<TData>(endpoint, body, fetchOptions, hash)

    // If somehow the server lost the query, re-register it (with retry limit)
    if (isPersistedQueryNotFound(result)) {
      registeredHashes.delete(hash)

      if (retryCount >= MAX_APQ_RETRIES) {
        throw new ApqExecutionError(
          `APQ re-registration failed after ${MAX_APQ_RETRIES} attempts`,
          'MAX_RETRIES_EXCEEDED',
          hash.substring(0, 8)
        )
      }

      return executeWithApq(
        endpoint,
        query,
        variables,
        fetchOptions,
        onMetric,
        retryCount + 1
      )
    }

    throwIfGraphQLError(result, hash, 'cached query')
    return result.data as TData
  }

  // First attempt: send hash only
  const hashOnlyBody = buildApqHashOnlyRequest(hash, variables)
  const hashOnlyResult = await executeFetch<TData>(
    endpoint,
    hashOnlyBody,
    fetchOptions,
    hash
  )

  // If server has the query, we're done
  if (!isPersistedQueryNotFound(hashOnlyResult)) {
    // Mark as registered for future requests
    markHashAsRegistered(hash)

    if (onMetric) {
      onMetric('graphql.apq.hit', 1, { hash: hash.substring(0, 8) })
    }

    throwIfGraphQLError(hashOnlyResult, hash, 'hash-only request')
    return hashOnlyResult.data as TData
  }

  // Server doesn't have the query - send full query for registration
  if (onMetric) {
    onMetric('graphql.apq.miss', 1, { hash: hash.substring(0, 8) })
  }

  const registerBody = buildApqRegisterRequest(query, hash, variables)
  const registerResult = await executeFetch<TData>(
    endpoint,
    registerBody,
    fetchOptions,
    hash
  )

  // Mark as registered for future requests
  markHashAsRegistered(hash)

  throwIfGraphQLError(registerResult, hash, 'registration')
  return registerResult.data as TData
}
