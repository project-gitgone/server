import {
  PERMISSIONS,
  permissionLevel,
  type EnvironmentScope,
  type Grant,
  type Permission,
  type PermissionLevel,
  type RoleScope,
} from '#services/rbac/permissions'

export const DEFAULT_ROLE_KEYS = [
  'owner',
  'admin',
  'member',
  'maintainer',
  'developer',
  'viewer',
] as const
export type DefaultRoleKey = (typeof DEFAULT_ROLE_KEYS)[number]

export type RoleDefinition = {
  key: DefaultRoleKey
  name: string
  description: string
  scope: RoleScope
  grants: Grant[]
}

const levels = (...wanted: PermissionLevel[]): Grant[] =>
  PERMISSIONS.filter((p) => wanted.includes(permissionLevel(p))).map((permission) => ({
    permission,
  }))

const onEnvironments = (environments: EnvironmentScope, ...permissions: Permission[]): Grant[] =>
  permissions.map((permission) => ({ permission, environments }))

const ALL: EnvironmentScope = { type: 'all' }
const UNPROTECTED: EnvironmentScope = { type: 'unprotected' }

export const DEFAULT_ROLES: Record<DefaultRoleKey, RoleDefinition> = {
  owner: {
    key: 'owner',
    name: 'Owner',
    description: 'Manages the whole instance, including its owners.',
    scope: 'instance',
    grants: levels('instance', 'team', 'project'),
  },
  admin: {
    key: 'admin',
    name: 'Admin',
    description: 'Manages the whole instance, except its owners.',
    scope: 'instance',
    grants: levels('instance', 'team', 'project'),
  },
  member: {
    key: 'member',
    name: 'Member',
    description: 'Can create teams. Access to projects comes from team and project roles.',
    scope: 'instance',
    grants: [{ permission: 'instance.teams.create' }],
  },
  maintainer: {
    key: 'maintainer',
    name: 'Maintainer',
    description: 'Manages the team or project and every environment.',
    scope: 'workspace',
    grants: [
      ...levels('team', 'project'),
      ...onEnvironments(ALL, 'env.read', 'env.write', 'env.rollback', 'env.history.read'),
    ],
  },
  developer: {
    key: 'developer',
    name: 'Developer',
    description: 'Reads every environment, writes the unprotected ones.',
    scope: 'workspace',
    grants: [
      ...onEnvironments(ALL, 'env.read', 'env.history.read'),
      ...onEnvironments(UNPROTECTED, 'env.write', 'env.rollback'),
    ],
  },
  viewer: {
    key: 'viewer',
    name: 'Viewer',
    description: 'Reads the unprotected environments.',
    scope: 'workspace',
    grants: onEnvironments(UNPROTECTED, 'env.read', 'env.history.read'),
  },
}

export const defaultRoleId = (key: DefaultRoleKey) => `role_${key}`
