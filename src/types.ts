/**
 * GraphQL Request Client Types
 */

import type { GraphQLClient } from 'graphql-request'

/**
 * APQ (Automatic Persisted Queries) configuration
 */
export interface ApqConfig {
  /** Enable APQ support (default: false) */
  enabled: boolean
}

export interface GraphQLClientConfig {
  /** GraphQL endpoint URL */
  endpoint: string
  /** Credentials mode for fetch (include for BFF pattern with httpOnly cookies) */
  credentials?: RequestCredentials
  /** Additional headers to include in requests */
  headers?: Record<string, string>
  /** Enable debug logging */
  debug?: boolean
  /** Custom isDevelopment check */
  isDevelopmentProvider?: () => boolean
  /**
   * Enable Automatic Persisted Queries (APQ)
   * Reduces payload size by sending query hashes instead of full queries
   */
  apq?: ApqConfig
  /** Callback for tracking metrics */
  onMetric?: (name: string, value: number, properties?: Record<string, unknown>) => void
  /** Callback for tracking errors */
  onError?: (name: string, error: unknown, properties?: Record<string, unknown>) => void
}

export interface GraphQLClientInstance {
  client: GraphQLClient
  request: <TData = unknown, TVariables extends Record<string, unknown> = Record<string, unknown>>(
    document: string,
    variables?: TVariables
  ) => Promise<TData>
}

export type OperationType = 'query' | 'mutation' | 'subscription'

/**
 * APQ error response from server
 */
export interface ApqError {
  message: string
  extensions?: {
    code?: 'PERSISTED_QUERY_NOT_FOUND' | 'PERSISTED_QUERY_HASH_MISMATCH' | string
  }
}

/**
 * GraphQL response with potential APQ errors
 */
export interface GraphQLResponse<T = unknown> {
  data?: T
  errors?: ApqError[]
}
