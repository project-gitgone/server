import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { DateTime } from 'luxon'
import { initAdminValidator } from '#validators/server'

export default class ServerController {
  async health({ response }: HttpContext) {
    const userCount = await User.query().count('* as total').first()
    const initialized = userCount?.$extras.total > 0

    return response.ok({
      status: 'ok',
      timestamp: DateTime.now().toISO(),
      initialized,
    })
  }

  async initAdmin({ request, response }: HttpContext) {
    const user = await User.first()
    if (user) {
      return response.forbidden({ message: 'Server is already initialized' })
    }

    const payload = await request.validateUsing(initAdminValidator)

    const superAdmin = await User.create({
      email: payload.email,
      password: payload.password,
      fullName: payload.fullName,
      publicKey: payload.publicKey,
      encryptedPrivateKey: payload.encryptedPrivateKey,
      keySalt: payload.keySalt,
      keyEncryptionAlgo: payload.keyEncryptionAlgo,
      systemRole: 'SUPERADMIN',
    })

    const token = await User.accessTokens.create(superAdmin)

    return response.created({
      message: 'Admin initialized successfully',
      user: {
        id: superAdmin.id,
        email: superAdmin.email,
        full_name: superAdmin.fullName,
        system_role: superAdmin.systemRole,
        publicKey: superAdmin.publicKey,
        encryptedPrivateKey: superAdmin.encryptedPrivateKey,
        keySalt: superAdmin.keySalt,
        keyEncryptionAlgo: superAdmin.keyEncryptionAlgo,
      },
      token: token,
    })
  }
}
