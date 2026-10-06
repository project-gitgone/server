import { environmentInScope, type EnvironmentRef } from '#services/rbac/environments'
import { permissionLevel, type Grant, type Permission } from '#services/rbac/permissions'

export type ScopeType = 'instance' | 'team' | 'project'
export type AssignmentGrants = { scopeType: ScopeType; scopeId: string | null; grants: Grant[] }
export type PermissionTarget = {
  teamId?: string
  project?: { id: string; teamId: string }
  environment?: EnvironmentRef | typeof ANY_ENVIRONMENT
}

export const ANY_ENVIRONMENT = '*' as const

export function applicable(assignments: AssignmentGrants[], target: PermissionTarget) {
  const teamId = target.project?.teamId ?? target.teamId
  return assignments.filter(
    (a) =>
      a.scopeType === 'instance' ||
      (a.scopeType === 'team' && teamId !== undefined && a.scopeId === teamId) ||
      (a.scopeType === 'project' && target.project !== undefined && a.scopeId === target.project.id)
  )
}

export function grantsAllow(
  grants: Grant[],
  permission: Permission,
  environment?: EnvironmentRef | typeof ANY_ENVIRONMENT
) {
  return grants.some((grant) => {
    if (grant.permission !== permission) return false
    if (permissionLevel(permission) !== 'env') return true
    if (environment === undefined) return false
    return (
      environment === ANY_ENVIRONMENT ||
      environmentInScope(grant.environments ?? { type: 'all' }, environment)
    )
  })
}

export function allows(
  assignments: AssignmentGrants[],
  permission: Permission,
  target: PermissionTarget = {}
) {
  const candidates = applicable(assignments, target).filter(
    (a) => permissionLevel(permission) !== 'team' || a.scopeType !== 'project'
  )
  return candidates.some((a) => grantsAllow(a.grants, permission, target.environment))
}

export function canSee(assignments: AssignmentGrants[], target: PermissionTarget) {
  const level = target.project ? 'project' : 'team'
  return applicable(assignments, target).some((a) =>
    a.scopeType === 'instance'
      ? a.grants.some((g) => permissionLevel(g.permission) === level)
      : a.scopeType === 'team' || target.project !== undefined
  )
}
