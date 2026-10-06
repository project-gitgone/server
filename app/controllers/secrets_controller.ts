import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import Project from '#models/project'
import SecretSnapshot from '#models/secret_snapshot'
import { permit } from '#abilities/main'
import { audit } from '#services/audit'
import { applyRetention, ensureEnvironment, environmentRef, snapshotsOf } from '#services/environments'
import { effectiveKeyring, keyringVersion } from '#services/keyring'
import { isEnvironmentName } from '#validators/environment'
import { pushSecretValidator } from '#validators/secret'
import env from '#start/env'

const serializeSnapshot = (snapshot: SecretSnapshot) => ({
  id: snapshot.id,
  projectId: snapshot.projectId,
  environment: snapshot.environment,
  version: snapshot.version,
  cryptoVersion: snapshot.cryptoVersion,
  keyVersion: snapshot.keyVersion,
  ciphertext: snapshot.ciphertext,
  iv: snapshot.iv,
  tag: snapshot.authTag,
})

export default class SecretsController {

  async push({ request, auth, bouncer, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(pushSecretValidator)

    const project = await Project.findOrFail(payload.projectId)

    const environment = await environmentRef(project.id, payload.environment)
    if (await bouncer.denies(permit, 'env.write', { project, environment })) {
      return response.forbidden({ message: `You cannot push to "${payload.environment}"` })
    }
    if (payload.rollbackOf) {
      if (await bouncer.denies(permit, 'env.rollback', { project, environment })) {
        return response.forbidden({ message: `You cannot roll back "${payload.environment}"` })
      }
      const source = await snapshotsOf(project.id, payload.environment).where('id', payload.rollbackOf).first()
      if (!source) {
        return response.unprocessableEntity({
          message: 'The snapshot to roll back to does not belong to this environment',
        })
      }
    }

    const stored = await ensureEnvironment(project.id, payload.environment)

    let outcome: { snapshot: SecretSnapshot } | { status: 403 | 409; message: string }
    try {
      outcome = await db.transaction(async (trx) => {
        const locked = await Project.query({ client: trx }).where('id', project.id).forUpdate().firstOrFail()
        const keyring = await effectiveKeyring(locked, payload.environment)
        const keyVersion = keyringVersion(keyring)

        const lastSnapshot = await snapshotsOf(project.id, payload.environment)
          .useTransaction(trx)
          .orderBy('version', 'desc')
          .first()
        const nextVersion = (lastSnapshot?.version || 0) + 1

        if (payload.cryptoVersion !== 2) {
          if (!env.get('ALLOW_LEGACY_CLIENTS', true)) {
            return { status: 403 as const, message: 'This server requires an up-to-date GitGone CLI.' }
          }
          if (keyring.kind === 'environment') {
            return { status: 409 as const, message: 'This environment has its own key: update your GitGone CLI.' }
          }
        } else {
          if ((payload.keyScope ?? 'project') !== keyring.kind) {
            return {
              status: 409 as const,
              message: 'The key of this environment changed since you fetched it. Update your GitGone CLI and retry.',
            }
          }
          if (payload.keyVersion !== keyVersion) {
            return { status: 409 as const, message: 'The key has been rotated since you fetched it. Please retry.' }
          }
          if (payload.version !== nextVersion) {
            return {
              status: 409 as const,
              message: `Another push was made in the meantime (expected v${nextVersion}). Pull the latest version and retry.`,
            }
          }
        }

        const snapshot = await SecretSnapshot.create(
          {
            projectId: project.id,
            environment: payload.environment,
            version: nextVersion,
            cryptoVersion: payload.cryptoVersion ?? 1,
            keyVersion,
            ciphertext: payload.encryptedData.ciphertext,
            iv: payload.encryptedData.iv,
            authTag: payload.encryptedData.authTag,
            createdBy: user.id,
          },
          { client: trx }
        )
        return { snapshot }
      })
    } catch (error) {
      if (error.code === '23505') {
        return response.conflict({
          message: 'Another push was made at the same time. Pull the latest version and retry.',
        })
      }
      throw error
    }

    if (!('snapshot' in outcome)) {
      return response.status(outcome.status).send({ message: outcome.message })
    }
    const { snapshot } = outcome
    await applyRetention(stored)
    await audit({ auth, request }, payload.rollbackOf ? 'secrets.rollback' : 'secrets.push', {
      projectId: project.id,
      environment: payload.environment,
      details: { version: snapshot.version, ...(payload.rollbackOf ? { rollbackOf: payload.rollbackOf } : {}) },
    })
    return response.created(snapshot)
  }

  async latest({ request, auth, bouncer, response }: HttpContext) {
    const qs = request.qs()
    if (!qs.projectId || !qs.env) {
      return response.badRequest({ message: 'Missing projectId or env query parameters' })
    }
    if (!isEnvironmentName(qs.env)) {
      return response.badRequest({ message: 'Invalid environment name' })
    }

    const project = await Project.findOrFail(qs.projectId)

    const environment = await environmentRef(project.id, qs.env)
    if (await bouncer.denies(permit, 'env.read', { project, environment })) {
      return response.forbidden({ message: `You cannot read "${qs.env}"` })
    }

    if (project.disallowPull && qs.mode !== 'memory') {
        return response.forbidden({ message: 'This project is configured for memory-only injection. Pull is disabled.' })
    }

    const snapshot = await snapshotsOf(project.id, qs.env)
      .orderBy('version', 'desc')
      .first()

    if (!snapshot) {
      return response.notFound({ message: 'No secrets found for this environment' })
    }

    await audit({ auth, request }, 'secrets.pull', {
      projectId: project.id,
      environment: qs.env,
      details: { version: snapshot.version },
    })
    return response.ok(serializeSnapshot(snapshot))
  }

  async history({ request, bouncer, response }: HttpContext) {
    const qs = request.qs()
    if (!qs.projectId || !qs.env) {
      return response.badRequest('Missing projectId or env query parameters')
    }
    if (!isEnvironmentName(qs.env)) {
      return response.badRequest('Invalid environment name')
    }

    try {
      const project = await Project.findOrFail(qs.projectId)

      const environment = await environmentRef(project.id, qs.env)
      if (await bouncer.denies(permit, 'env.history.read', { project, environment })) {
        return response.forbidden(`You cannot read the history of "${qs.env}"`)
      }

      const history = await snapshotsOf(project.id, qs.env)
        .orderBy('version', 'desc')
        .preload('creator', (q) => q.select('id', 'email', 'full_name'))
        .select('id', 'version', 'crypto_version', 'key_version', 'created_at', 'created_by')

        if(history.length === 0) {
          return response.notFound('No secret history found for this environment')
        }

      return response.ok(history)
    } catch (error) {
      throw error;
    }
  }


  async getVersion({ params, request, auth, bouncer, response }: HttpContext) {
    const snapshot = await SecretSnapshot.findOrFail(params.id)
    await snapshot.load('project')

    if (
      await bouncer.denies(permit, 'env.read', {
        project: snapshot.project,
        environment: await environmentRef(snapshot.projectId, snapshot.environment),
      })
    ) {
      return response.forbidden('You cannot read this environment')
    }

    await audit({ auth, request }, 'secrets.pull', {
      projectId: snapshot.projectId,
      environment: snapshot.environment,
      details: { version: snapshot.version },
    })
    return response.ok(serializeSnapshot(snapshot))
  }
}
