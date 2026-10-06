import Project from '#models/project'
import { revokeLostKeys } from '#services/keyring'
import { audit } from '#services/audit'
import type { HttpContext } from '@adonisjs/core/http'
import Role from '#models/role'
import RoleAssignment from '#models/role_assignment'
import { permit } from '#abilities/main'
import {
  LEVELS_BY_SCOPE,
  normalizeGrants,
  permissionLevel,
  PERMISSIONS,
} from '#services/rbac/permissions'
import { createRoleValidator, updateRoleValidator } from '#validators/role'

const nameTaken = (name: string, exceptId?: string) => {
  const query = Role.query().whereRaw('lower(name) = ?', [name.toLowerCase()])
  return (exceptId ? query.whereNot('id', exceptId) : query).first()
}

async function projectsUsing(role: Role) {
  const assignments = await RoleAssignment.query().where('role_id', role.id)
  const ids = (type: 'team' | 'project') =>
    assignments.filter((a) => a.scopeType === type).map((a) => a.scopeId as string)
  return Project.query().where((q) => q.whereIn('team_id', ids('team')).orWhereIn('id', ids('project')))
}

export default class RolesController {
  async permissions({ response }: HttpContext) {
    return response.ok({
      permissions: PERMISSIONS.map((key) => ({ key, level: permissionLevel(key) })),
      levelsByScope: LEVELS_BY_SCOPE,
    })
  }

  async index({ response }: HttpContext) {
    return response.ok(await Role.query().orderBy('is_system', 'desc').orderBy('name'))
  }

  async store({ request, auth, bouncer, response }: HttpContext) {
    if (await bouncer.denies(permit, 'instance.roles.manage')) {
      return response.forbidden({ message: 'You are not allowed to manage roles' })
    }
    const payload = await request.validateUsing(createRoleValidator)
    if (await nameTaken(payload.name))
      return response.conflict({ message: 'A role with this name already exists' })

    const role = await Role.create({
      name: payload.name,
      description: payload.description ?? null,
      scope: payload.scope,
      isSystem: false,
      grants: normalizeGrants(payload.scope, payload.grants),
    })
    await audit({ auth, request }, 'roles.create', { targetType: 'role', targetId: role.id })
    return response.created(role)
  }

  async update({ params, request, auth, bouncer, response }: HttpContext) {
    if (await bouncer.denies(permit, 'instance.roles.manage')) {
      return response.forbidden({ message: 'You are not allowed to manage roles' })
    }
    const role = await Role.findOrFail(params.id)
    if (role.isSystem)
      return response.conflict({
        message: 'Default roles cannot be changed: duplicate them instead',
      })

    const payload = await request.validateUsing(updateRoleValidator)
    if (payload.name && (await nameTaken(payload.name, role.id))) {
      return response.conflict({ message: 'A role with this name already exists' })
    }
    role.merge({
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.grants ? { grants: normalizeGrants(role.scope, payload.grants) } : {}),
    })
    await role.save()
    await audit({ auth, request }, 'roles.update', { targetType: 'role', targetId: role.id })
    const revoked = payload.grants ? await revokeLostKeys(await projectsUsing(role)) : {}
    return response.ok({ ...role.serialize(), ...revoked })
  }

  async destroy({ params, request, auth, bouncer, response }: HttpContext) {
    if (await bouncer.denies(permit, 'instance.roles.manage')) {
      return response.forbidden({ message: 'You are not allowed to manage roles' })
    }
    const role = await Role.findOrFail(params.id)
    if (role.isSystem) return response.conflict({ message: 'Default roles cannot be deleted' })
    if (await RoleAssignment.query().where('role_id', role.id).first()) {
      return response.conflict({ message: 'This role is still assigned: replace it first' })
    }
    await role.delete()
    await audit({ auth, request }, 'roles.delete', { targetType: 'role', targetId: role.id })
    return response.noContent()
  }
}
