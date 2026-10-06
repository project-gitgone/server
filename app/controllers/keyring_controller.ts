import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import db from '@adonisjs/lucid/services/db'
import Project from '#models/project'
import Environment from '#models/environment'
import EnvironmentKey from '#models/environment_key'
import ProjectKey from '#models/project_key'
import SecretSnapshot from '#models/secret_snapshot'
import { permit, see } from '#abilities/main'
import { audit } from '#services/audit'
import { ensureEnvironment } from '#services/environments'
import {
  deleteCount,
  environmentKeyring,
  findUserKey,
  keyHolders,
  keyringRecipients,
  keyringSnapshots,
  keyringTokens,
  keyringVersion,
  projectKeyring,
  saveUserKey,
  type Keyring,
} from '#services/keyring'
import type { EnvironmentRef } from '#services/rbac/environments'
import { ANY_ENVIRONMENT } from '#services/rbac/resolve'
import { isEnvironmentName } from '#validators/environment'
import { rotateProjectKeyValidator, shareProjectKeyValidator } from '#validators/key'

type Resolved = {
  project: Project
  own: Keyring
  effective: Keyring
  target: EnvironmentRef | typeof ANY_ENVIRONMENT
}

async function resolve({ params }: HttpContext): Promise<Resolved> {
  const project = await Project.findOrFail(params.projectId)
  if (params.environment === undefined) {
    const keyring = projectKeyring(project)
    return { project, own: keyring, effective: keyring, target: ANY_ENVIRONMENT }
  }
  if (!isEnvironmentName(params.environment)) {
    throw new Exception('Invalid environment name', { status: 400 })
  }
  const own = await environmentKeyring(project, params.environment)
  const environment = (own as Extract<Keyring, { kind: 'environment' }>).environment
  return {
    project,
    own,
    effective: keyringVersion(own) > 0 ? own : projectKeyring(project),
    target: { name: environment.name, protected: environment.protected },
  }
}

const canRotate = async ({ bouncer }: HttpContext, { project, target }: Resolved) =>
  (await bouncer.allows(permit, 'project.keys.rotate', { project })) &&
  (await bouncer.allows(permit, 'env.read', { project, environment: target }))

const environmentRecord = (keyring: Keyring) =>
  keyring.kind === 'environment' ? keyring.environment.record : null

const environmentName = (keyring: Keyring) =>
  keyring.kind === 'environment' ? keyring.environment.name : undefined

const sameIds = (expected: string[], sent: string[]) => {
  const expectedSet = new Set(expected)
  const sentSet = new Set(sent)
  return (
    sentSet.size === sent.length &&
    sentSet.size === expectedSet.size &&
    [...sentSet].every((id) => expectedSet.has(id))
  )
}

export default class KeyringController {
  async show(ctx: HttpContext) {
    const { auth, bouncer, response, params } = ctx
    const resolved = await resolve(ctx)
    const { project, own, effective, target } = resolved
    if (await bouncer.denies(permit, 'env.read', { project, environment: target })) {
      return response.forbidden({ message: 'Access denied' })
    }
    if (params.environment !== undefined && !environmentRecord(own)) {
      return response.notFound({ message: 'Unknown environment' })
    }

    const key = await findUserKey(effective, auth.getUserOrFail().id)
    if (!key) {
      return response.notFound({
        message:
          'The key has not been shared with you yet. Ask a maintainer to run "gitgone keys share".',
      })
    }

    return response.ok({
      scope: effective.kind,
      encryptedKey: key.encryptedKey,
      keyVersion: keyringVersion(effective),
      rotationRequired: environmentRecord(own)?.rotationRequired ?? false,
      canSeparate:
        own.kind === 'environment' &&
        effective.kind === 'project' &&
        (await canRotate(ctx, resolved)),
    })
  }

  async pending(ctx: HttpContext) {
    const { bouncer, response } = ctx
    const { project, effective: keyring } = await resolve(ctx)
    if (await bouncer.denies(permit, 'project.members.manage', { project })) {
      return response.forbidden({ message: 'Access denied' })
    }
    const recipients = await keyringRecipients(keyring)
    return response.ok(
      await recipients
        .query()
        .whereNotIn('id', keyHolders(keyring))
        .select('id', 'email', 'full_name', 'public_key')
    )
  }

  async share(ctx: HttpContext) {
    const { request, auth, bouncer, response } = ctx
    const { project, effective: keyring, target } = await resolve(ctx)
    if (
      (await bouncer.denies(permit, 'project.members.manage', { project })) ||
      (await bouncer.denies(permit, 'env.read', { project, environment: target }))
    ) {
      return response.forbidden({ message: 'Access denied' })
    }
    const payload = await request.validateUsing(shareProjectKeyValidator)
    if (payload.keyVersion !== undefined && payload.keyVersion !== keyringVersion(keyring)) {
      return response.conflict({
        message: 'The key has been rotated since you fetched it. Please retry.',
      })
    }

    const recipients = await keyringRecipients(keyring)
    if (!(await recipients.query().where('id', payload.targetUserId).first())) {
      return response.unprocessableEntity({ message: 'Target user is not allowed to read this' })
    }

    await saveUserKey(keyring, payload.targetUserId, payload.encryptedKey)
    await audit({ auth, request }, 'keys.share', {
      projectId: keyring.project.id,
      environment: environmentName(keyring),
      targetType: 'user',
      targetId: payload.targetUserId,
    })
    return response.ok({ message: 'Key shared successfully' })
  }

  async recipients(ctx: HttpContext) {
    const { bouncer, response } = ctx
    const { project, own: keyring } = await resolve(ctx)
    if (await bouncer.denies(see, { project })) {
      return response.forbidden({ message: 'Access denied' })
    }
    const recipients = await keyringRecipients(keyring)
    return response.ok(await recipients.query().select('id', 'email', 'full_name', 'public_key'))
  }

  async snapshots(ctx: HttpContext) {
    const { response } = ctx
    const resolved = await resolve(ctx)
    const keyring = resolved.own
    if (!(await canRotate(ctx, resolved))) {
      return response.forbidden({ message: 'You cannot rotate this key' })
    }

    const snapshots = await keyringSnapshots(keyring).orderBy('environment').orderBy('version')
    return response.ok({
      keyVersion: keyringVersion(keyring),
      snapshots: snapshots.map((s) => ({
        id: s.id,
        environment: s.environment,
        version: s.version,
        cryptoVersion: s.cryptoVersion,
        ciphertext: s.ciphertext,
        iv: s.iv,
        tag: s.authTag,
      })),
    })
  }

  async rotate(ctx: HttpContext) {
    const { request, auth, bouncer, response } = ctx
    let resolved = await resolve(ctx)
    let keyring = resolved.own
    const { project, target } = resolved
    const payload = await request.validateUsing(rotateProjectKeyValidator)

    const initializing =
      keyring.kind === 'environment' &&
      keyringVersion(keyring) === 0 &&
      payload.snapshots.length === 0 &&
      !(await keyringSnapshots(keyring).first())
    const allowed = initializing
      ? (await bouncer.allows(permit, 'env.write', { project, environment: target })) &&
        (await bouncer.allows(permit, 'env.read', { project, environment: target }))
      : await canRotate(ctx, resolved)
    if (!allowed) return response.forbidden({ message: 'You cannot rotate this key' })

    if (initializing && !environmentRecord(keyring)) {
      await ensureEnvironment(project.id, environmentName(keyring)!)
      resolved = await resolve(ctx)
      keyring = resolved.own
    }

    return db.transaction(async (trx) => {
      const lockedProject = await Project.query({ client: trx })
        .where('id', keyring.project.id)
        .forUpdate()
        .firstOrFail()
      const lockedEnvironment =
        keyring.kind === 'environment'
          ? await Environment.query({ client: trx })
              .where('id', environmentRecord(keyring)!.id)
              .forUpdate()
              .firstOrFail()
          : null
      const current = lockedEnvironment
        ? (lockedEnvironment.keyVersion ?? 0)
        : lockedProject.keyVersion
      if (current !== payload.expectedKeyVersion) {
        return response.conflict({ message: 'The key has already been rotated. Please retry.' })
      }

      const recipients = await keyringRecipients(keyring, trx)
      const readers = await recipients.query().select('id')
      if (
        !sameIds(
          readers.map((u) => u.id),
          payload.keys.map((k) => k.userId)
        )
      ) {
        return response.unprocessableEntity({
          message: 'The new key must be shared with exactly the current readers. Please retry.',
        })
      }

      const existing = await keyringSnapshots(keyring, trx).select('id')
      if (
        !sameIds(
          existing.map((s) => s.id),
          payload.snapshots.map((s) => s.id)
        )
      ) {
        return response.conflict({
          message: 'Secrets were pushed during the rotation. Please retry.',
        })
      }

      const newKeyVersion = current + 1
      for (const snapshot of payload.snapshots) {
        await SecretSnapshot.query({ client: trx }).where('id', snapshot.id).update({
          ciphertext: snapshot.ciphertext,
          iv: snapshot.iv,
          auth_tag: snapshot.authTag,
          crypto_version: 2,
          key_version: newKeyVersion,
        })
      }

      if (lockedEnvironment) {
        await EnvironmentKey.query({ client: trx })
          .where('environment_id', lockedEnvironment.id)
          .delete()
      } else {
        await ProjectKey.query({ client: trx }).where('project_id', lockedProject.id).delete()
      }
      for (const key of payload.keys) {
        await saveUserKey(keyring, key.userId, key.encryptedKey, trx)
      }

      const revokedTokens = await deleteCount(keyringTokens(keyring, trx))

      if (lockedEnvironment) {
        lockedEnvironment.merge({ keyVersion: newKeyVersion, rotationRequired: false })
        await lockedEnvironment.useTransaction(trx).save()
      } else {
        lockedProject.keyVersion = newKeyVersion
        await lockedProject.useTransaction(trx).save()
      }

      await audit({ auth, request }, 'keys.rotate', {
        projectId: lockedProject.id,
        environment: environmentName(keyring),
        details: { keyVersion: newKeyVersion, revokedTokens },
        client: trx,
      })
      return response.ok({ keyVersion: newKeyVersion, revokedTokens })
    })
  }
}
