import { audit } from '#services/audit'
import RoleAssignment from '#models/role_assignment'
import Team from '#models/team'
import { grantsAllow } from '#services/rbac/resolve'
import type { HttpContext } from '@adonisjs/core/http'
import hash from '@adonisjs/core/services/hash'
import crypto from 'node:crypto'
import { DateTime } from 'luxon'
import env from '#start/env'
import User, { V2_KEY_ENCRYPTION_ALGO, type KdfParams } from '#models/user'
import {
  activateAccountValidator,
  changePasswordValidator,
  loginValidator,
  preloginValidator,
  upgradeAccountValidator,
} from '#validators/auth'

function decoyKdfParams(email: string): KdfParams {
  const salt = crypto
    .createHmac('sha256', env.get('APP_KEY'))
    .update(`prelogin:${email}`)
    .digest()
    .subarray(0, 16)
    .toString('base64')

  return { algo: 'scrypt', salt, N: 2 ** 17, r: 8, p: 1 }
}

export default class AuthController {
  async prelogin({ request, response }: HttpContext) {
    const { email } = await request.validateUsing(preloginValidator)
    const user = await User.findActiveByEmail(email)

    if (user && user.cryptoVersion === 1) {
      return response.ok({ cryptoVersion: 1 })
    }

    return response.ok({
      cryptoVersion: 2,
      kdf: user?.kdfParams ?? decoyKdfParams(email),
    })
  }

  async login({ request, auth, response }: HttpContext) {
    const { email, ...credentials } = await request.validateUsing(loginValidator)

    const user = await User.verifyCredentials(email, credentials)

    if (!user) {
      const known = await User.findActiveByEmail(email)
      await audit({ auth, request }, 'auth.login.failed', {
        actor: { type: 'user', id: known?.id ?? 'unknown', label: email },
      })
      return response.unauthorized('Invalid credentials')
    }

    if (user.cryptoVersion === 1 && !env.get('ALLOW_LEGACY_CLIENTS', true)) {
      return response.forbidden({
        message: 'This account uses a retired encryption scheme. Ask an administrator to reset it.',
      })
    }

    const token = await User.accessTokens.create(user)
    await audit({ auth, request }, 'auth.login', {
      actor: { type: 'user', id: user.id, label: user.email },
    })

    return response.ok({ token, user: user.toAuthJSON() })
  }

  async me({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const assignments = await RoleAssignment.query().where('user_id', user.id).preload('role')
    const instance = assignments.find((a) => a.scopeType === 'instance')
    const teamAssignments = assignments.filter((a) => a.scopeType === 'team')
    const teams = await Team.query().whereIn(
      'id',
      teamAssignments.map((a) => a.scopeId as string)
    )

    return response.ok({
      user: user.serialize(),
      instanceRole: instance
        ? { id: instance.role.id, key: instance.role.key, name: instance.role.name }
        : null,
      permissions: [...new Set((instance?.role.effectiveGrants ?? []).map((g) => g.permission))],
      teams: teams.map((team) => {
        const role = teamAssignments.find((a) => a.scopeId === team.id)!.role
        return {
          id: team.id,
          name: team.name,
          role: grantsAllow(role.effectiveGrants, 'team.members.manage') ? 'OWNER' : 'MEMBER',
          roleId: role.id,
          roleKey: role.key,
          roleName: role.name,
        }
      }),
    })
  }

  async upgrade({ request, auth, response }: HttpContext) {
    const user = auth.use('api').getUserOrFail()

    if (user.cryptoVersion !== 1) {
      return response.conflict({ message: 'Account is already upgraded' })
    }

    const payload = await request.validateUsing(upgradeAccountValidator)

    if (!user.password || !(await hash.verify(user.password, payload.password))) {
      return response.unauthorized({ message: 'Invalid password' })
    }

    user.merge({
      password: payload.authKey,
      cryptoVersion: 2,
      kdfParams: payload.kdf,
      encryptedPrivateKey: payload.encryptedPrivateKey,
      keySalt: null,
      keyEncryptionAlgo: V2_KEY_ENCRYPTION_ALGO,
    })
    await user.save()

    await User.revokeAccessTokens(user, user.currentAccessToken.identifier)

    await audit({ auth, request }, 'auth.upgrade')
    return response.ok({ user: user.toAuthJSON() })
  }

  async changePassword({ request, auth, response }: HttpContext) {
    const user = auth.use('api').getUserOrFail()

    if (user.cryptoVersion !== 2) {
      return response.conflict({
        message: 'Log in again with an up-to-date CLI to upgrade your account first',
      })
    }

    const payload = await request.validateUsing(changePasswordValidator)

    if (!user.password || !(await hash.verify(user.password, payload.currentAuthKey))) {
      return response.unauthorized({ message: 'Invalid current password' })
    }

    user.merge({
      password: payload.authKey,
      kdfParams: payload.kdf,
      encryptedPrivateKey: payload.encryptedPrivateKey,
    })
    await user.save()

    await User.revokeAccessTokens(user, user.currentAccessToken.identifier)

    await audit({ auth, request }, 'auth.password')
    return response.ok({ user: user.toAuthJSON() })
  }

  async activate({ request, auth, response }: HttpContext) {
    const payload = await request.validateUsing(activateAccountValidator)
    const invalid = () => response.badRequest({ message: 'Invalid or expired activation code' })

    const user = await User.findActiveByEmail(payload.email)
    if (
      !user ||
      !user.activationCode ||
      !user.activationExpiresAt ||
      user.activationExpiresAt < DateTime.now()
    ) {
      return invalid()
    }

    if (!(await hash.verify(user.activationCode, payload.code))) {
      return invalid()
    }

    user.merge({
      password: payload.authKey,
      cryptoVersion: 2,
      kdfParams: payload.kdf,
      publicKey: payload.publicKey,
      encryptedPrivateKey: payload.encryptedPrivateKey,
      keySalt: null,
      keyEncryptionAlgo: V2_KEY_ENCRYPTION_ALGO,
      activationCode: null,
      activationExpiresAt: null,
    })
    await user.save()

    const token = await User.accessTokens.create(user)

    await audit({ auth, request }, 'auth.activate', {
      actor: { type: 'user', id: user.id, label: user.email },
    })
    return response.ok({ token, user: user.toAuthJSON() })
  }
}
