import { Exception } from '@adonisjs/core/exceptions'
import User from '#models/user'
import Project from '#models/project'
import Role from '#models/role'
import RoleAssignment from '#models/role_assignment'
import PermissionResolver from '#services/rbac/permission_resolver'
import { defaultRoleId } from '#services/rbac/default_roles'
import { legacyInstanceRoleKey, legacyTeamRoleKey } from '#services/rbac/legacy'
import type { EnvironmentRef } from '#services/rbac/environments'
import { ANY_ENVIRONMENT, grantsAllow, type PermissionTarget } from '#services/rbac/resolve'
import {
  permissionLevel,
  type Grant,
  type Permission,
  type RoleScope,
} from '#services/rbac/permissions'

export class AccessRuleError extends Exception {
  static status = 422
}

export class AccessDeniedError extends Exception {
  static status = 403
}

export type Scope =
  | { type: 'instance' }
  | { type: 'team'; id: string }
  | { type: 'project'; id: string }

const scopeId = (scope: Scope) => (scope.type === 'instance' ? null : scope.id)
const roleScopeOf = (scope: Scope): RoleScope =>
  scope.type === 'instance' ? 'instance' : 'workspace'

export const findAssignment = (userId: string, scope: Scope) => {
  const query = RoleAssignment.query().where('user_id', userId).where('scope_type', scope.type)
  return (
    scope.type === 'instance' ? query.whereNull('scope_id') : query.where('scope_id', scope.id)
  )
    .preload('role')
    .first()
}

export function roleIdFromInput(
  input: { roleId?: string; role?: string; systemRole?: string },
  scope: RoleScope
) {
  if (input.roleId) return input.roleId
  return defaultRoleId(
    scope === 'instance' ? legacyInstanceRoleKey(input.systemRole) : legacyTeamRoleKey(input.role)
  )
}

export async function hasActiveInstanceOwner() {
  return !!(await RoleAssignment.query()
    .where('scope_type', 'instance')
    .where('role_id', defaultRoleId('owner'))
    .whereHas('user', (user) => user.whereNull('deleted_at'))
    .first())
}

export async function isInstanceOwner(user: { id: string } | null | undefined) {
  if (!user) return false
  const assignment = await findAssignment(user.id, { type: 'instance' })
  return assignment?.role.key === 'owner'
}

const GUARDS = {
  instance: {
    holds: (role: Role) => role.key === 'owner',
    message: 'The instance must keep at least one owner',
  },
  team: {
    holds: (role: Role) => grantsAllow(role.effectiveGrants, 'team.members.manage'),
    message: 'The team must keep at least one member able to manage it',
  },
} as const

export async function assertNotLastGuardian(assignment: RoleAssignment, nextRole: Role | null) {
  const guard = assignment.scopeType === 'project' ? null : GUARDS[assignment.scopeType]
  if (!guard || !guard.holds(assignment.role) || (nextRole && guard.holds(nextRole))) return

  const others = await RoleAssignment.query()
    .where('scope_type', assignment.scopeType)
    .where((q) =>
      assignment.scopeId ? q.where('scope_id', assignment.scopeId) : q.whereNull('scope_id')
    )
    .whereNot('id', assignment.id)
    .whereHas('user', (user) => user.whereNull('deleted_at'))
    .preload('role')
  if (!others.some((other) => guard.holds(other.role))) throw new AccessRuleError(guard.message)
}

export async function assertCanActOn(actor: { id: string }, targetUserId: string) {
  const target = await findAssignment(targetUserId, { type: 'instance' })
  if (target?.role.key === 'owner' && !(await isInstanceOwner(actor))) {
    throw new AccessDeniedError('Only an owner can manage an owner')
  }
}

const MANAGE_PERMISSION: Record<Scope['type'], Permission> = {
  instance: 'instance.users.manage',
  team: 'team.members.manage',
  project: 'project.members.manage',
}

const sampleEnvironments = (grant: Grant): EnvironmentRef[] => {
  const scope = grant.environments ?? { type: 'all' }
  if (scope.type === 'list') return scope.names.map((name) => ({ name, protected: true }))
  const development = { name: 'development', protected: false }
  return scope.type === 'all'
    ? [{ name: 'production', protected: true }, development]
    : [development]
}

async function assertCanGrant(actor: User, targetUserId: string, role: Role, scope: Scope) {
  const resolver = PermissionResolver.for(actor)
  const instanceGrants = await resolver.instanceGrants()
  const managesFromInstance = instanceGrants.some(
    (g) => g.permission === MANAGE_PERMISSION[scope.type]
  )
  if (managesFromInstance && actor.id !== targetUserId) return

  const target: PermissionTarget =
    scope.type === 'team'
      ? { teamId: scope.id }
      : scope.type === 'project'
        ? { project: await Project.findOrFail(scope.id) }
        : {}
  for (const grant of role.effectiveGrants) {
    const environments =
      permissionLevel(grant.permission) === 'env' ? sampleEnvironments(grant) : [ANY_ENVIRONMENT]
    for (const environment of environments) {
      if (!(await resolver.can(grant.permission, { ...target, environment }))) {
        throw new AccessDeniedError(`You cannot grant ${grant.permission}: you do not hold it`)
      }
    }
  }
}

export async function setRole(userId: string, roleId: string, scope: Scope, actor?: User) {
  const role = await Role.find(roleId)
  if (!role) throw new AccessRuleError('Unknown role')
  if (role.scope !== roleScopeOf(scope)) {
    throw new AccessRuleError(`The role "${role.name}" cannot be assigned on a ${scope.type}`)
  }

  if (actor) {
    if (scope.type === 'instance') {
      if (role.key === 'owner' && !(await isInstanceOwner(actor))) {
        throw new AccessDeniedError('Only an owner can manage owners')
      }
      await assertCanActOn(actor, userId)
    }
    await assertCanGrant(actor, userId, role, scope)
  }

  const existing = await findAssignment(userId, scope)
  if (existing) {
    await assertNotLastGuardian(existing, role)
    existing.roleId = role.id
    await existing.save()
    return existing
  }
  return RoleAssignment.create({
    userId,
    roleId: role.id,
    scopeType: scope.type,
    scopeId: scopeId(scope),
  })
}

export async function removeRole(userId: string, scope: Scope) {
  const existing = await findAssignment(userId, scope)
  if (!existing) throw new AccessRuleError('This user has no role here')
  await assertNotLastGuardian(existing, null)
  await existing.delete()
}
