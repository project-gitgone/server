import type { EnvironmentScope } from '#services/rbac/permissions'

export type EnvironmentRef = { name: string; protected: boolean }

const PROTECTED_BY_DEFAULT = new Set(['production', 'prod'])

export const defaultProtection = (name: string) =>
  PROTECTED_BY_DEFAULT.has(name.trim().toLowerCase())

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function environmentInScope(scope: EnvironmentScope, environment: EnvironmentRef) {
  if (scope.type === 'all') return true
  if (scope.type === 'unprotected') return !environment.protected
  return scope.names.some((name) => sameName(name, environment.name))
}
