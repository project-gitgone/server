import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Exception } from '@adonisjs/core/exceptions'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import LoginCode from '#models/login_code'
import RoleAssignment from '#models/role_assignment'
import User from '#models/user'
import UserIdentity, { CLOUD_PROVIDER } from '#models/user_identity'
import { cloudConfig } from '#services/cloud'
import { defaultRoleId, type DefaultRoleKey } from '#services/rbac/default_roles'

export type CloudProfile = {
  subject: string
  email: string
  name: string | null
  emailVerified: boolean
  organization: string | null
  role: string | null
}

export class CloudLoginDeniedError extends Exception {
  static status = 403
}

export class InvalidLoginCodeError extends Exception {
  static status = 400
}

const CLOUD_TO_INSTANCE_ROLE: Record<string, DefaultRoleKey> = { owner: 'owner', admin: 'admin' }

const instanceRoleOf = (cloudRole: string | null) =>
  (cloudRole && CLOUD_TO_INSTANCE_ROLE[cloudRole]) || 'member'

export const EMAIL_NOT_VERIFIED = 'Verify your email on GitGone Cloud to access this instance'

const LOGIN_CODE_TTL_MINUTES = 2

const sha256 = (value: string) => createHash('sha256').update(value).digest()

export async function completeCloudLogin(profile: CloudProfile) {
  const config = cloudConfig()
  if (!profile.email) {
    throw new CloudLoginDeniedError('Your cloud account has no email address')
  }
  if (!config || profile.organization !== config.instanceId || !profile.role) {
    throw new CloudLoginDeniedError(
      'You are not a member of the organization that owns this instance'
    )
  }

  try {
    return await linkCloudProfile(profile)
  } catch (error) {
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error
    return linkCloudProfile(profile)
  }
}

const UNIQUE_VIOLATION = '23505'

function linkCloudProfile(profile: CloudProfile) {
  return db.transaction(async (trx) => {
    const identity = await UserIdentity.query({ client: trx })
      .where('provider', CLOUD_PROVIDER)
      .where('subject', profile.subject)
      .first()
    const local = identity
      ? await User.findOrFail(identity.userId, { client: trx })
      : await User.query({ client: trx })
          .whereRaw('lower(email) = ?', [profile.email.toLowerCase()])
          .first()

    if (local?.deletedAt) {
      throw new CloudLoginDeniedError('This account is deactivated on this instance')
    }
    if (identity) return local!
    if (!profile.emailVerified) {
      throw new CloudLoginDeniedError(EMAIL_NOT_VERIFIED)
    }

    const user =
      local ??
      (await User.create(
        {
          email: profile.email,
          fullName: profile.name || profile.email.split('@')[0],
          cryptoVersion: 2,
        },
        { client: trx }
      ))
    if (!local) {
      await RoleAssignment.create(
        {
          userId: user.id,
          roleId: defaultRoleId(instanceRoleOf(profile.role)),
          scopeType: 'instance',
          scopeId: null,
        },
        { client: trx }
      )
    }
    await UserIdentity.create(
      { userId: user.id, provider: CLOUD_PROVIDER, subject: profile.subject },
      { client: trx }
    )
    return user
  })
}

export async function issueLoginCode(user: User, codeChallenge: string) {
  await LoginCode.query().where('expires_at', '<', DateTime.now().toSQL()).delete()
  const code = randomBytes(32).toString('base64url')
  await LoginCode.create({
    codeHash: sha256(code).toString('hex'),
    userId: user.id,
    codeChallenge,
    expiresAt: DateTime.now().plus({ minutes: LOGIN_CODE_TTL_MINUTES }),
  })
  return code
}

export async function redeemLoginCode(code: string, codeVerifier: string) {
  const userId = await db.transaction(async (trx) => {
    const record = await LoginCode.query({ client: trx })
      .where('code_hash', sha256(code).toString('hex'))
      .forUpdate()
      .first()
    if (!record || record.expiresAt < DateTime.now()) return null
    const challenge = Buffer.from(sha256(codeVerifier).toString('base64url'))
    const expected = Buffer.from(record.codeChallenge)
    if (challenge.length !== expected.length || !timingSafeEqual(challenge, expected)) return null
    await record.useTransaction(trx).delete()
    return record.userId
  })
  const user = userId
    ? await User.query().where('id', userId).whereNull('deleted_at').first()
    : null
  if (!user) throw new InvalidLoginCodeError('Invalid or expired login code')
  return user
}
