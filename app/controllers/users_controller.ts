import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import SystemPolicy from '#policies/system_policy'
import { DateTime } from 'luxon'
import { createUserValidator, updateUserValidator } from '#validators/user'
import env from '#start/env'

export default class UsersController {


  async index({ request, bouncer, response }: HttpContext) {
    if (await bouncer.with(SystemPolicy).denies('manage')) {
        return response.forbidden('You are not authorized to view users')
    }

    const page = request.input('page', 1)
    const limit = request.input('limit', 20)
    const search = request.input('search')

    const query = User.query().whereNull('deleted_at')

    if (search) {
      query.where((q) => {
        q.where('email', 'ilike', `%${search}%`)
          .orWhere('full_name', 'ilike', `%${search}%`)
      })
    }

    const users = await query.paginate(page, limit)

    return response.ok(users)
  }

  async store({ request, bouncer, response }: HttpContext) {
    const isSuperAdmin = await bouncer.with(SystemPolicy).allows('manage')
    const allowRegistration = env.get('ALLOW_REGISTRATION', true)

    if (!isSuperAdmin && !allowRegistration) {
      return response.forbidden('User registration is currently disabled on this server.')
    }

    const payload = await request.validateUsing(createUserValidator)

    const existing = await User.findBy('email', payload.email)
    if (existing) {
        if (existing.deletedAt) {
             return response.badRequest('User with this email exists but is deleted. Please restore or contact admin.')
        }
        return response.badRequest('Email already in use')
    }

    const user = await User.create({
      email: payload.email,
      password: payload.password,
      fullName: payload.fullName,
      systemRole: isSuperAdmin ? (payload.systemRole || 'USER') : 'USER',
      publicKey: payload.publicKey,
      encryptedPrivateKey: payload.encryptedPrivateKey,
      keySalt: payload.keySalt,
      keyEncryptionAlgo: payload.keyEncryptionAlgo,
    })

    return response.created(user)
  }

  async update({ request, params, bouncer, response }: HttpContext) {
     if (await bouncer.with(SystemPolicy).denies('manage')) {
      return response.forbidden('You are not authorized to update users')
    }

    const userToUpdate = await User.findOrFail(params.id)

    const payload = await request.validateUsing(updateUserValidator)

      userToUpdate.merge(payload)
      await userToUpdate.save()

      return response.ok(userToUpdate)
  }


  async destroy({ params, bouncer, response, auth }: HttpContext) {
    if (await bouncer.with(SystemPolicy).denies('manage')) {
      return response.forbidden('You are not authorized to delete users')
    }

    const userToDelete = await User.findOrFail(params.id)

    if (userToDelete.id === auth.getUserOrFail().id) {
        return response.badRequest('You cannot delete your own account.')
    }

    userToDelete.deletedAt = DateTime.now()
    await userToDelete.save()

    return response.ok({ message: 'User deleted successfully' })
  }
}
