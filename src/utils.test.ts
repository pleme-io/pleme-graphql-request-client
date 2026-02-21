import { describe, it, expect } from 'vitest'
import { extractOperationName, extractOperationType, isDevelopment } from './utils'

describe('utils', () => {
  describe('extractOperationName', () => {
    it('extracts query operation name', () => {
      const query = `query GetUsers { users { id name } }`
      expect(extractOperationName(query)).toBe('GetUsers')
    })

    it('extracts mutation operation name', () => {
      const mutation = `mutation CreateUser($input: CreateUserInput!) { createUser(input: $input) { id } }`
      expect(extractOperationName(mutation)).toBe('CreateUser')
    })

    it('extracts subscription operation name', () => {
      const subscription = `subscription OnUserCreated { userCreated { id name } }`
      expect(extractOperationName(subscription)).toBe('OnUserCreated')
    })

    it('returns anonymous for unnamed operations', () => {
      const query = `{ users { id } }`
      expect(extractOperationName(query)).toBe('anonymous')
    })

    it('handles case insensitivity', () => {
      const query = `QUERY GetUsers { users { id } }`
      expect(extractOperationName(query)).toBe('GetUsers')
    })
  })

  describe('extractOperationType', () => {
    it('returns query for query operations', () => {
      expect(extractOperationType('query GetUsers { users { id } }')).toBe('query')
    })

    it('returns mutation for mutation operations', () => {
      expect(extractOperationType('mutation CreateUser { createUser { id } }')).toBe('mutation')
    })

    it('returns subscription for subscription operations', () => {
      expect(extractOperationType('subscription OnUser { userCreated { id } }')).toBe('subscription')
    })

    it('defaults to query for anonymous operations', () => {
      expect(extractOperationType('{ users { id } }')).toBe('query')
    })

    it('handles whitespace', () => {
      expect(extractOperationType('  mutation CreateUser { }')).toBe('mutation')
    })

    it('handles case insensitivity', () => {
      expect(extractOperationType('MUTATION CreateUser { }')).toBe('mutation')
    })
  })

  describe('isDevelopment', () => {
    it('returns true for localhost', () => {
      // jsdom defaults to localhost
      expect(isDevelopment()).toBe(true)
    })
  })
})
