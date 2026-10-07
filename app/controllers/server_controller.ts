import { readFileSync } from 'node:fs'
import app from '@adonisjs/core/services/app'
import { cloudConfig, cloudLoginConfig } from '#services/cloud'
import { audit } from '#services/audit'
import type { HttpContext } from '@adonisjs/core/http'
import User, { V2_KEY_ENCRYPTION_ALGO } from '#models/user'
import { DateTime } from 'luxon'
import { initAdminValidator } from '#validators/server'
import { defaultRoleId } from '#services/rbac/default_roles'
import { hasActiveInstanceOwner, setRole } from '#services/rbac/assignments'
import { instanceHealth } from '#services/instance_health'
import env from '#start/env'

const packageVersion = JSON.parse(readFileSync(app.makePath('package.json'), 'utf8'))
  .version as string

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

  async welcome({ request, response, view }: HttpContext) {
    const instanceName = env.get('INSTANCE_NAME') || 'default'
    if (
      request.accepts(['html', 'json']) === 'json' ||
      request.header('accept')?.includes('json')
    ) {
      return response.ok({ status: 'ok', instance: instanceName })
    }
    if (env.get('STATUS_PAGE') === false) return response.notFound()

    const health = await instanceHealth()
    const hasAdmin = health.databaseLatency !== null && (await hasActiveInstanceOwner())
    const healthy = health.databaseLatency !== null && health.pendingMigrations === 0

    return view.render('welcome', {
      status: !healthy ? 'degraded' : hasAdmin ? 'ok' : 'setup',
      hasAdmin,
      version: packageVersion,
      serverUrl: env.get('APP_URL') || `${request.protocol()}://${request.host()}`,
      cloudLogin: !!cloudLoginConfig(),
    })
  }

  async health({ response }: HttpContext) {
    return response.ok({
      status: 'ok',
      timestamp: DateTime.now().toISO(),
      initialized: await hasActiveInstanceOwner(),
    })
  }

  async initAdmin({ request, auth, response }: HttpContext) {
    if (cloudLoginConfig()) {
      return response.forbidden({
        message:
          'This instance is managed by GitGone Cloud: run "gitgone login" with your cloud account',
      })
    }
    if (await hasActiveInstanceOwner()) {
      return response.forbidden({ message: 'Server is already initialized' })
    }

    const payload = await request.validateUsing(initAdminValidator)
    const taken = await User.query()
      .whereRaw('lower(email) = ?', [payload.email.toLowerCase()])
      .first()
    if (taken) {
      return response.conflict({ message: 'An account already uses this email address' })
    }

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
