/**
 * @pleme/graphql-request-client
 *
 * GraphQL client factory using graphql-request with BFF pattern, APQ support, and metrics.
 *
 * @example
 * ```ts
 * import { createGraphQLClient, createQueryFn } from '@pleme/graphql-request-client'
 * import { createObservability } from '@pleme/observability'
 *
 * const observability = createObservability()
 *
 * // Create client with APQ and metrics integration
 * const { client, request } = createGraphQLClient({
 *   endpoint: '/graphql',
 *   credentials: 'include', // BFF pattern with httpOnly cookies
 *   apq: { enabled: true }, // Enable Automatic Persisted Queries
 *   onMetric: (name, value, props) => observability.trackMetric(name, value, undefined, props),
 *   onError: (name, error, props) => observability.trackError(name, error, props),
 * })
 *
 * // Direct requests
 * const data = await request<{ users: User[] }>(GET_USERS_QUERY)
 *
 * // With TanStack Query
 * const getUsers = createQueryFn<{ users: User[] }>(client, GET_USERS_QUERY)
 * const { data } = useQuery({ queryKey: ['users'], queryFn: getUsers })
 * ```
 */

// Types
export type {
  ApqConfig,
  ApqError,
  GraphQLClientConfig,
  GraphQLClientInstance,
  GraphQLResponse,
  OperationType,
} from './types'

// Client factory
export { createGraphQLClient, createQueryFn } from './client'

// Utilities
export { extractOperationName, extractOperationType, isDevelopment } from './utils'

// APQ utilities (for advanced use cases)
export {
  ApqExecutionError,
  clearRegisteredHashes,
  computeQueryHash,
  getCacheStats,
  isPersistedQueryNotFound,
} from './apq'
