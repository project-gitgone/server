import { Exception } from '@adonisjs/core/exceptions'

export const PERMISSIONS = [
  'instance.users.manage',
  'instance.roles.manage',
  'instance.teams.create',
  'instance.audit.read',
  'team.manage',
  'team.members.manage',
  'team.projects.create',
  'project.manage',
  'project.members.manage',
  'project.environments.manage',
  'project.tokens.manage',
  'project.keys.rotate',
  'project.audit.read',
  'env.read',
  'env.write',
  'env.rollback',
  'env.history.read',
] as const

export type Permission = (typeof PERMISSIONS)[number]
export type PermissionLevel = 'instance' | 'team' | 'project' | 'env'

export const isPermission = (value: string): value is Permission =>
  (PERMISSIONS as readonly string[]).includes(value)

export const permissionLevel = (permission: Permission) =>
  permission.split('.')[0] as PermissionLevel

export type EnvironmentScope =
  | { type: 'all' }
  | { type: 'unprotected' }
  | { type: 'list'; names: string[] }
export type Grant = { permission: Permission; environments?: EnvironmentScope }

export type RoleScope = 'instance' | 'workspace'

export const LEVELS_BY_SCOPE: Record<RoleScope, PermissionLevel[]> = {
  instance: ['instance', 'team', 'project'],
  workspace: ['team', 'project', 'env'],
}

export class InvalidGrantsError extends Exception {
  static status = 422
}

function normalizeEnvironmentScope(raw: unknown): EnvironmentScope {
  if (raw === undefined) return { type: 'all' }
  const scope = raw as { type?: unknown; names?: unknown }
  if (scope?.type === 'all' || scope?.type === 'unprotected') return { type: scope.type }
  if (scope?.type === 'list' && Array.isArray(scope.names)) {
    const names = [...new Set(scope.names.map((name) => String(name).trim()).filter(Boolean))]
    if (names.length > 0) return { type: 'list', names }
  }
  throw new InvalidGrantsError(
    'environments must be { type: "all" | "unprotected" } or a non-empty list'
  )
}

export function normalizeGrants(scope: RoleScope, input: unknown): Grant[] {
  if (!Array.isArray(input)) throw new InvalidGrantsError('grants must be an array')

  const seen = new Set<string>()
  return input.map((raw) => {
    const permission = (raw as { permission?: unknown })?.permission
    if (typeof permission !== 'string' || !isPermission(permission)) {
      throw new InvalidGrantsError(`Unknown permission: ${String(permission)}`)
    }
    if (!LEVELS_BY_SCOPE[scope].includes(permissionLevel(permission))) {
      throw new InvalidGrantsError(`${permission} cannot be granted by a ${scope} role`)
    }
    if (seen.has(permission)) throw new InvalidGrantsError(`Duplicate permission: ${permission}`)
    seen.add(permission)

    const environments = (raw as { environments?: unknown }).environments
    if (permissionLevel(permission) !== 'env') {
      if (environments !== undefined)
        throw new InvalidGrantsError(`${permission} does not take environments`)
      return { permission }
    }
    return { permission, environments: normalizeEnvironmentScope(environments) }
  })
}
