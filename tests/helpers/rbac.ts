import User from '#models/user'
import RoleAssignment from '#models/role_assignment'
import { defaultRoleId, type DefaultRoleKey } from '#services/rbac/default_roles'

export const createUser = (email: string) =>
  User.create({
    email,
    password: 'password123',
    fullName: email.split('@')[0],
    publicKey: `pub_${email}`,
  })

type Scope = 'instance' | { team: { id: string } } | { project: { id: string } }

export function grantRole(user: { id: string }, key: DefaultRoleKey, scope: Scope = 'instance') {
  const [scopeType, scopeId] =
    scope === 'instance'
      ? (['instance', null] as const)
      : 'team' in scope
        ? (['team', scope.team.id] as const)
        : (['project', scope.project.id] as const)
  return RoleAssignment.create({ userId: user.id, roleId: defaultRoleId(key), scopeType, scopeId })
}
