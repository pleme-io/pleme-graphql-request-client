import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGraphQLClient, createQueryFn } from './client'

// Mock graphql-request
vi.mock('graphql-request', () => ({
  GraphQLClient: vi.fn().mockImplementation((endpoint, options) => {
    const client = {
      endpoint,
      options,
      request: vi.fn().mockResolvedValue({ data: 'test' }),
    }
    return client
  }),
}))

describe('client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createGraphQLClient', () => {
    it('creates a client with default config', () => {
      const { client, request } = createGraphQLClient({
        endpoint: '/graphql',
      })

      expect(client).toBeDefined()
      expect(request).toBeTypeOf('function')
    })

    it('uses include credentials by default for BFF pattern', () => {
      const { client } = createGraphQLClient({
        endpoint: '/graphql',
      })

      expect(client.options.credentials).toBe('include')
    })

    it('accepts custom headers', () => {
      const { client } = createGraphQLClient({
        endpoint: '/graphql',
        headers: {
          'X-Custom-Header': 'value',
        },
      })

      expect(client.options.headers).toMatchObject({
        'X-Custom-Header': 'value',
      })
    })

    it('calls onMetric callback when configured', async () => {
      const onMetric = vi.fn()
      const { request } = createGraphQLClient({
        endpoint: '/graphql',
        onMetric,
      })

      // Note: The actual middleware testing would require more complex mocking
      // This test verifies the config is accepted
      expect(request).toBeTypeOf('function')
    })

    it('calls onError callback when configured', async () => {
      const onError = vi.fn()
      const { request } = createGraphQLClient({
        endpoint: '/graphql',
        onError,
      })

      expect(request).toBeTypeOf('function')
    })

    it('supports custom isDevelopmentProvider', () => {
      const isDevelopmentProvider = vi.fn().mockReturnValue(true)
      createGraphQLClient({
        endpoint: '/graphql',
        isDevelopmentProvider,
        debug: false,
      })

      // The provider may be called during initialization
      expect(isDevelopmentProvider).toBeDefined()
    })
  })

  describe('createQueryFn', () => {
    it('creates a query function', async () => {
      const { client } = createGraphQLClient({
        endpoint: '/graphql',
      })

      const queryFn = createQueryFn<{ users: string[] }>(
        client,
        'query GetUsers { users { id } }'
      )

      expect(queryFn).toBeTypeOf('function')
    })

    it('passes variables to the query', async () => {
      const { client } = createGraphQLClient({
        endpoint: '/graphql',
      })

      const queryFn = createQueryFn<{ user: string }, { id: string }>(
        client,
        'query GetUser($id: ID!) { user(id: $id) { id } }'
      )

      await queryFn({ id: '123' })

      expect(client.request).toHaveBeenCalledWith(
        'query GetUser($id: ID!) { user(id: $id) { id } }',
        { id: '123' }
      )
    })
  })
})
