/**
 * GraphQL Client Factory
 *
 * Creates a GraphQL client using graphql-request with BFF pattern support,
 * optional APQ (Automatic Persisted Queries), and metrics/error tracking.
 */

import { GraphQLClient } from 'graphql-request'
import { executeWithApq } from './apq'
import type { GraphQLClientConfig, GraphQLClientInstance } from './types'
import { extractOperationName, extractOperationType, isDevelopment } from './utils'

// Re-export RequestFn type for external usage
export type { GraphQLClientInstance }

const DEFAULT_CONFIG: Partial<GraphQLClientConfig> = {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
  },
  debug: false,
}

/**
 * Create a GraphQL client with BFF pattern support, optional APQ, and metrics.
 *
 * @example
 * ```ts
 * import { createGraphQLClient } from '@pleme/graphql-request-client'
 *
 * const { client, request } = createGraphQLClient({
 *   endpoint: '/graphql',
 *   apq: { enabled: true },  // Enable APQ for reduced payload sizes
 *   onMetric: (name, value, props) => observability.trackMetric(name, value, undefined, props),
 *   onError: (name, error, props) => observability.trackError(name, error, props),
 * })
 *
 * // Use the request function for typed requests
 * const data = await request<{ users: User[] }>(GET_USERS_QUERY)
 * ```
 */
export function createGraphQLClient(
  config: GraphQLClientConfig
): GraphQLClientInstance {
  const finalConfig = { ...DEFAULT_CONFIG, ...config }
  const isDebug =
    finalConfig.debug || (finalConfig.isDevelopmentProvider?.() ?? isDevelopment())
  const apqEnabled = finalConfig.apq?.enabled ?? false

  const client = new GraphQLClient(finalConfig.endpoint, {
    ...(finalConfig.credentials !== undefined ? { credentials: finalConfig.credentials } : {}),
    ...(finalConfig.headers !== undefined ? { headers: finalConfig.headers } : {}),
    requestMiddleware: (request) => {
      const startTime = performance.now()
      const body = typeof request.body === 'string' ? request.body : ''
      const operationName = extractOperationName(body)
      const operationType = extractOperationType(body)

      if (isDebug) {
        console.log(`[GraphQL] ${operationType} ${operationName} starting`)
      }

      return {
        ...request,
        headers: {
          ...(request.headers as Record<string, string>),
          'x-operation-name': operationName,
          'x-operation-type': operationType,
          'x-request-start': startTime.toString(),
        },
      }
    },
    responseMiddleware: (response) => {
      // Try to get timing info from headers
      const headers = (response as { headers?: Headers }).headers
      const startTimeStr = headers?.get?.('x-request-start')
      const operationName = headers?.get?.('x-operation-name') ?? 'anonymous'
      const operationType = headers?.get?.('x-operation-type') ?? 'query'

      const startTime = startTimeStr ? parseFloat(startTimeStr) : 0

      if (startTime > 0) {
        const duration = performance.now() - startTime

        if (finalConfig.onMetric) {
          finalConfig.onMetric(`graphql.${operationType}.duration`, duration, {
            operation: operationName,
          })
        }

        if (isDebug) {
          console.log(
            `[GraphQL] ${operationType} ${operationName} completed in ${duration.toFixed(2)}ms`
          )
        }
      }

      if (response instanceof Error) {
        if (isDebug) {
          console.error(`[GraphQL] ${operationType} ${operationName} failed:`, response)
        }

        if (finalConfig.onError) {
          finalConfig.onError(`graphql.${operationType}.error`, response, {
            operation: operationName,
          })
        }
      }
    },
  })

  // Create APQ-enabled request function if APQ is enabled
  const apqRequest = async <TData = unknown, TVariables extends Record<string, unknown> = Record<string, unknown>>(
    document: string,
    variables?: TVariables
  ): Promise<TData> => {
    const startTime = performance.now()
    const operationName = extractOperationName(document)
    const operationType = extractOperationType(document)

    if (isDebug) {
      console.log(`[GraphQL APQ] ${operationType} ${operationName} starting`)
    }

    try {
      const result = await executeWithApq<TData, TVariables>(
        finalConfig.endpoint,
        document,
        variables,
        {
          ...(finalConfig.credentials !== undefined ? { credentials: finalConfig.credentials } : {}),
          headers: {
            'Content-Type': 'application/json',
            ...finalConfig.headers,
          },
        },
        finalConfig.onMetric
      )

      const duration = performance.now() - startTime

      if (finalConfig.onMetric) {
        finalConfig.onMetric(`graphql.${operationType}.duration`, duration, {
          operation: operationName,
          apq: true,
        })
      }

      if (isDebug) {
        console.log(
          `[GraphQL APQ] ${operationType} ${operationName} completed in ${duration.toFixed(2)}ms`
        )
      }

      return result
    } catch (error) {
      if (isDebug) {
        console.error(`[GraphQL APQ] ${operationType} ${operationName} failed:`, error)
      }

      if (finalConfig.onError) {
        finalConfig.onError(`graphql.${operationType}.error`, error, {
          operation: operationName,
          apq: true,
        })
      }

      throw error
    }
  }

  // Non-APQ request function with proper error handling
  const standardRequest = async <TData = unknown, TVariables extends Record<string, unknown> = Record<string, unknown>>(
    document: string,
    variables?: TVariables
  ): Promise<TData> => {
    const startTime = performance.now()
    const operationName = extractOperationName(document)
    const operationType = extractOperationType(document)

    try {
      const result = await client.request<TData>(document, variables)

      const duration = performance.now() - startTime

      if (finalConfig.onMetric) {
        finalConfig.onMetric(`graphql.${operationType}.duration`, duration, {
          operation: operationName,
          apq: false,
        })
      }

      if (isDebug) {
        console.log(
          `[GraphQL] ${operationType} ${operationName} completed in ${duration.toFixed(2)}ms`
        )
      }

      return result
    } catch (error) {
      if (isDebug) {
        console.error(`[GraphQL] ${operationType} ${operationName} failed:`, error)
      }

      if (finalConfig.onError) {
        finalConfig.onError(`graphql.${operationType}.error`, error, {
          operation: operationName,
          apq: false,
        })
      }

      throw error
    }
  }

  return {
    client,
    request: apqEnabled ? apqRequest : standardRequest,
  }
}

/**
 * Request function type from GraphQLClientInstance
 */
type RequestFn = GraphQLClientInstance['request']

/**
 * Create a typed query function for use with TanStack Query.
 *
 * Uses the APQ-enabled request function from createGraphQLClient for optimal
 * performance with automatic persisted queries when APQ is enabled.
 *
 * @example
 * ```ts
 * const { request } = createGraphQLClient({
 *   endpoint: '/graphql',
 *   apq: { enabled: true },
 * })
 *
 * const getUsers = createQueryFn<{ users: User[] }>(request, GET_USERS_QUERY)
 *
 * // In a React component with TanStack Query
 * const { data } = useQuery({
 *   queryKey: ['users'],
 *   queryFn: () => getUsers(),
 * })
 * ```
 */
export function createQueryFn<TData, TVariables extends Record<string, unknown> = Record<string, unknown>>(
  request: RequestFn,
  document: string
) {
  return async (variables?: TVariables): Promise<TData> => {
    return request<TData, TVariables>(document, variables)
  }
}
