import { Exception } from '@adonisjs/core/exceptions'
import { DateTime } from 'luxon'
import User from '#models/user'
import UserIdentity, { CLOUD_PROVIDER } from '#models/user_identity'
import { revokeAllKeysOf } from '#services/keyring'
import { assertNotLastGuardian, findAssignment } from '#services/rbac/assignments'

export async function userOfCloudSubject(subject: string, options: { active?: boolean } = {}) {
  const identity = await UserIdentity.query()
    .where('provider', CLOUD_PROVIDER)
    .where('subject', subject)
    .first()
  if (!identity) return null
  const query = User.query().where('id', identity.userId)
  if (options.active) query.whereNull('deleted_at')
  return query.first()
}

export async function deactivateUser(
  user: User,
  options: { by: 'instance' | 'cloud'; revokeKeys: boolean }
) {
  const instanceRole = await findAssignment(user.id, { type: 'instance' })
  if (instanceRole) await assertNotLastGuardian(instanceRole, null)

  user.merge({ deletedAt: DateTime.now(), deactivatedBy: options.by })
  await user.save()
  await User.revokeAccessTokens(user)
  if (options.revokeKeys) await revokeAllKeysOf(user.id)
}

export class NotRestorableError extends Exception {
  static status = 409
}

export async function restoreCloudUser(user: User) {
  if (user.deletedAt && user.deactivatedBy !== 'cloud') {
    throw new NotRestorableError('This account was deactivated on the instance itself')
  }
  user.merge({ deletedAt: null, deactivatedBy: null })
  await user.save()
}
