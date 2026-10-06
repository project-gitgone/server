import { audit, auditAccess } from '#services/audit'
import { deactivateUser } from '#services/accounts'
import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { revokeAllKeysOf } from '#services/keyring'
import { permit } from '#abilities/main'
import { defaultRoleId } from '#services/rbac/default_roles'
import {
  assertCanActOn,
  isInstanceOwner,
  roleIdFromInput,
  setRole,
} from '#services/rbac/assignments'
import { createUserValidator, updateUserValidator } from '#validators/user'
import env from '#start/env'

export default class UsersController {
  async index({ request, bouncer, response }: HttpContext) {
    if (await bouncer.denies(permit, 'instance.users.manage')) {
      return response.forbidden('You are not authorized to manage users')
    }

    const page = request.input('page', 1)
    const limit = request.input('limit', 20)
    const search = request.input('search')

    const query = User.query()
      .whereNull('deleted_at')
      .preload('instanceRole', (q) => q.preload('role'))

    if (search) {
      query.where((q) => {
        q.where('email', 'ilike', `%${search}%`).orWhere('full_name', 'ilike', `%${search}%`)
      })
    }

    const users = await query.paginate(page, limit)

    return response.ok(users)
  }

  async store({ request, auth, bouncer, response }: HttpContext) {
    const isManager = await bouncer.allows(permit, 'instance.users.manage')
    const allowRegistration = env.get('ALLOW_REGISTRATION', true)

    if (!isManager && !allowRegistration) {
      return response.forbidden('User registration is currently disabled on this server.')
    }

    const payload = await request.validateUsing(createUserValidator)

    const existing = await User.findBy('email', payload.email)
    if (existing) {
      if (existing.deletedAt) {
        return response.badRequest(
          'User with this email exists but is deleted. Please restore or contact admin.'
        )
      }
      return response.badRequest('Email already in use')
    }

    const roleId = isManager ? roleIdFromInput(payload, 'instance') : defaultRoleId('member')
    const actor = auth.user
    if (roleId === defaultRoleId('owner') && !(await isInstanceOwner(actor))) {
      return response.forbidden('Only an owner can create another owner')
    }

    const user = new User()
    user.merge({
      email: payload.email,
      fullName: payload.fullName,
      cryptoVersion: 2,
    })
    const activationCode = await user.issueActivationCode()
    await user.save()
    await setRole(user.id, roleId, { type: 'instance' }, isManager ? actor : undefined)

    await audit({ auth, request }, 'users.create', { targetType: 'user', targetId: user.id })
    await auditAccess({ auth, request }, 'access.grant', { userId: user.id, scope: { type: 'instance' }, roleId })
    return response.created({
      user,
      activationCode,
      activationExpiresAt: user.activationExpiresAt,
    })
  }

  async update({ request, params, auth, bouncer, response }: HttpContext) {
    if (await bouncer.denies(permit, 'instance.users.manage')) {
      return response.forbidden('You are not authorized to manage users')
    }

    const userToUpdate = await User.findOrFail(params.id)
    await assertCanActOn(auth.getUserOrFail(), userToUpdate.id)

    const payload = await request.validateUsing(updateUserValidator)

    userToUpdate.merge(payload)
    await userToUpdate.save()
    await audit({ auth, request }, 'users.update', {
      targetType: 'user',
      targetId: userToUpdate.id,
      details: { fields: Object.keys(payload) },
    })

    return response.ok(userToUpdate)
  }

  async resetCredentials({ params, request, bouncer, response, auth }: HttpContext) {
    if (await bouncer.denies(permit, 'instance.users.manage')) {
      return response.forbidden('You are not authorized to manage users')
    }

    const user = await User.query().where('id', params.id).whereNull('deleted_at').firstOrFail()

    if (user.id === auth.getUserOrFail().id) {
      return response.badRequest('Use `gitgone passwd` to change your own password.')
    }
    await assertCanActOn(auth.getUserOrFail(), user.id)

    user.merge({
      password: null,
      cryptoVersion: 2,
      kdfParams: null,
      publicKey: null,
      encryptedPrivateKey: null,
      keySalt: null,
      keyEncryptionAlgo: null,
    })
    const activationCode = await user.issueActivationCode()
    await user.save()

    await revokeAllKeysOf(user.id)
    await User.revokeAccessTokens(user)

    await audit({ auth, request }, 'users.reset', { targetType: 'user', targetId: user.id })
    return response.ok({ activationCode, activationExpiresAt: user.activationExpiresAt })
  }

  async destroy({ params, request, bouncer, response, auth }: HttpContext) {
    if (await bouncer.denies(permit, 'instance.users.manage')) {
      return response.forbidden('You are not authorized to manage users')
    }

    const userToDelete = await User.findOrFail(params.id)

    if (userToDelete.id === auth.getUserOrFail().id) {
      return response.badRequest('You cannot delete your own account.')
    }
    await assertCanActOn(auth.getUserOrFail(), userToDelete.id)
    await deactivateUser(userToDelete, { by: 'instance', revokeKeys: false })

    await audit({ auth, request }, 'users.delete', { targetType: 'user', targetId: userToDelete.id })
    return response.ok({ message: 'User deleted successfully' })
  }
}
