/**
 * GraphQL Utility Functions
 */

import type { OperationType } from './types'

/**
 * Extract GraphQL operation name from query document
 */
export function extractOperationName(document: string): string {
  const match = document.match(/(?:query|mutation|subscription)\s+(\w+)/i)
  return match?.[1] ?? 'anonymous'
}

/**
 * Extract operation type from query document
 */
export function extractOperationType(document: string): OperationType {
  const trimmed = document.trim().toLowerCase()
  if (trimmed.startsWith('mutation')) return 'mutation'
  if (trimmed.startsWith('subscription')) return 'subscription'
  return 'query'
}

/**
 * Default development check
 */
export function isDevelopment(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const windowEnv = (window as { ENV?: { VITE_ENV?: string } }).ENV
  if (windowEnv?.VITE_ENV) {
    return windowEnv.VITE_ENV === 'development'
  }

  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.local')
  )
}
