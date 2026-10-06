import { Bouncer } from '@adonisjs/bouncer'
import type User from '#models/user'
import PermissionResolver from '#services/rbac/permission_resolver'
import type { Permission } from '#services/rbac/permissions'
import type { PermissionTarget } from '#services/rbac/resolve'

export const permit = Bouncer.ability((user: User, permission: Permission, target?: PermissionTarget) =>
  PermissionResolver.for(user).can(permission, target)
)

export const see = Bouncer.ability((user: User, target: PermissionTarget) => PermissionResolver.for(user).canSee(target))
