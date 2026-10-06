import { readFileSync } from 'node:fs'
import app from '@adonisjs/core/services/app'
import { cloudConfig, cloudLoginConfig } from '#services/cloud'
import { audit } from '#services/audit'
import type { HttpContext } from '@adonisjs/core/http'
import User, { V2_KEY_ENCRYPTION_ALGO } from '#models/user'
import { DateTime } from 'luxon'
import { initAdminValidator } from '#validators/server'
import { defaultRoleId } from '#services/rbac/default_roles'
import { setRole } from '#services/rbac/assignments'

const packageVersion = JSON.parse(readFileSync(app.makePath('package.json'), 'utf8')).version as string

export default class ServerController {
  async capabilities({ response }: HttpContext) {
    return response.ok({
      version: packageVersion,
      features: [
        'rbac',
        'environments',
        'audit',
        'environment-keys',
        ...(cloudConfig() ? ['cloud'] : []),
        ...(cloudLoginConfig() ? ['cloud-login'] : []),
      ],
    })
  }

  async health({ response }: HttpContext) {
    const userCount = await User.query().count('* as total').first()
    const initialized = userCount?.$extras.total > 0

    return response.ok({
      status: 'ok',
      timestamp: DateTime.now().toISO(),
      initialized,
    })
  }

  async initAdmin({ request, auth, response }: HttpContext) {
    const user = await User.first()
    if (user) {
      return response.forbidden({ message: 'Server is already initialized' })
    }

    const payload = await request.validateUsing(initAdminValidator)

    const superAdmin = await User.create({
      email: payload.email,
      password: payload.authKey,
      fullName: payload.fullName,
      cryptoVersion: 2,
      kdfParams: payload.kdf,
      publicKey: payload.publicKey,
      encryptedPrivateKey: payload.encryptedPrivateKey,
      keyEncryptionAlgo: V2_KEY_ENCRYPTION_ALGO,
    })
    await setRole(superAdmin.id, defaultRoleId('owner'), { type: 'instance' })

    await audit({ auth, request }, 'auth.init', {
      actor: { type: 'user', id: superAdmin.id, label: superAdmin.email },
    })
    const token = await User.accessTokens.create(superAdmin)

    return response.created({
      message: 'Admin initialized successfully',
      user: superAdmin.toAuthJSON(),
      token: token,
    })
  }
}
