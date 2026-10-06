import type { EnvironmentRef } from '#services/rbac/environments'
import type User from '#models/user'
import RoleAssignment from '#models/role_assignment'
import {
  PERMISSIONS,
  permissionLevel,
  type Grant,
  type Permission,
} from '#services/rbac/permissions'
import {
  allows,
  ANY_ENVIRONMENT,
  canSee,
  grantsAllow,
  type AssignmentGrants,
  type PermissionTarget,
} from '#services/rbac/resolve'

const toAssignmentGrants = (a: RoleAssignment): AssignmentGrants => ({
  scopeType: a.scopeType,
  scopeId: a.scopeId,
  grants: a.role.effectiveGrants,
})

const resolvers = new WeakMap<User, PermissionResolver>()

export default class PermissionResolver {
  static for(user: User) {
    let resolver = resolvers.get(user)
    if (!resolver) {
      resolver = new PermissionResolver(user.id)
      resolvers.set(user, resolver)
    }
    return resolver
  }

  #loaded?: Promise<AssignmentGrants[]>

  constructor(private userId: string) {}

  assignments() {
    this.#loaded ??= RoleAssignment.query()
      .where('user_id', this.userId)
      .preload('role')
      .then((rows) => rows.map(toAssignmentGrants))
    return this.#loaded
  }

  async can(permission: Permission, target: PermissionTarget = {}) {
    return allows(await this.assignments(), permission, target)
  }

  async permissionsOn(target: PermissionTarget, levels: Permission[] = [...PERMISSIONS]) {
    const assignments = await this.assignments()
    return levels.filter((permission) => allows(assignments, permission, target))
  }

  async canSee(target: PermissionTarget) {
    return canSee(await this.assignments(), target)
  }

  async instanceGrants(): Promise<Grant[]> {
    const assignments = await this.assignments()
    return assignments.filter((a) => a.scopeType === 'instance').flatMap((a) => a.grants)
  }

  async projectVisibility() {
    const assignments = await this.assignments()
    const instanceGrants = await this.instanceGrants()
    if (instanceGrants.some((g) => permissionLevel(g.permission) === 'project')) {
      return { all: true as const }
    }
    const ids = (type: 'team' | 'project') =>
      assignments.filter((a) => a.scopeType === type).map((a) => a.scopeId as string)
    return { all: false as const, teamIds: ids('team'), projectIds: ids('project') }
  }
}

export const projectAssignments = (project: { id: string; teamId: string }) =>
  RoleAssignment.query()
    .where((q) => {
      q.where((t) => t.where('scope_type', 'team').where('scope_id', project.teamId)).orWhere((p) =>
        p.where('scope_type', 'project').where('scope_id', project.id)
      )
    })
    .preload('role')

export async function usersWithPermission(
  project: { id: string; teamId: string },
  permission: Permission,
  environment: EnvironmentRef | typeof ANY_ENVIRONMENT = ANY_ENVIRONMENT
) {
  const rows = await projectAssignments(project)
  return [
    ...new Set(
      rows
        .filter((r) => grantsAllow(r.role.effectiveGrants, permission, environment))
        .map((r) => r.userId)
    ),
  ]
}
