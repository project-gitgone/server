import type { HttpContext } from '@adonisjs/core/http'
import Project from '#models/project'
import ProjectToken from '#models/project_token'
import { permit } from '#abilities/main'
import { audit } from '#services/audit'
import { environmentRef, snapshotsOf } from '#services/environments'
import { createProjectTokenValidator } from '#validators/project_token'
import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'
import env from '#start/env'

const legacyTokensAllowed = () => env.get('ALLOW_LEGACY_TOKENS', true)

export default class ProjectTokensController {
  async index({ params, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.projectId)
    if (await bouncer.denies(permit, 'project.tokens.manage', { project })) {
      return response.forbidden('You cannot manage the tokens of this project')
    }

    const tokens = await ProjectToken.query()
      .where('project_id', project.id)
      .orderBy('created_at', 'desc')
      .preload('creator', (q) => q.select('id', 'full_name', 'email'))

    return response.ok(tokens)
  }

  async store({ params, request, auth, bouncer, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const project = await Project.findOrFail(params.projectId)

    const payload = await request.validateUsing(createProjectTokenValidator)

    if (
      (await bouncer.denies(permit, 'project.tokens.manage', { project })) ||
      (await bouncer.denies(permit, 'env.read', {
        project,
        environment: await environmentRef(project.id, payload.environment),
      }))
    ) {
      return response.forbidden(`You cannot create a token for "${payload.environment}"`)
    }

    let verifier: string
    let cryptoVersion: number
    if (payload.authVerifier) {
      verifier = payload.authVerifier
      cryptoVersion = 2
    } else if (payload.tokenSecretHash && legacyTokensAllowed()) {
      verifier = payload.tokenSecretHash
      cryptoVersion = 1
    } else {
      return response.unprocessableEntity({
        message: 'authVerifier is required. Please update your GitGone CLI.',
      })
    }

    const token = await ProjectToken.create({
      name: payload.name,
      token: await hash.make(verifier),
      cryptoVersion,
      projectId: project.id,
      environment: payload.environment,
      encryptedProjectKey: payload.encryptedProjectKey,
      createdBy: user.id,
      expiresAt: payload.expiresAt ? DateTime.fromISO(payload.expiresAt) : null,
    })

    await audit({ auth, request }, 'tokens.create', {
      projectId: project.id,
      environment: token.environment,
      targetType: 'token',
      targetId: token.id,
    })
    return response.created(token)
  }

  async destroy({ params, request, auth, bouncer, response }: HttpContext) {
    const token = await ProjectToken.findOrFail(params.id)
    const project = await Project.findOrFail(token.projectId)

    if (await bouncer.denies(permit, 'project.tokens.manage', { project })) {
      return response.forbidden('You cannot manage the tokens of this project')
    }

    await token.delete()
    await audit({ auth, request }, 'tokens.revoke', {
      projectId: project.id,
      environment: token.environment,
      targetType: 'token',
      targetId: token.id,
    })
    return response.noContent()
  }

  async getEnv({ request, auth, response }: HttpContext) {
    const authHeader = request.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return response.unauthorized('Missing token')
    }

    const parts = authHeader.substring(7).split('.')
    const cryptoVersion = parts.length === 3 && parts[0] === 'v2' ? 2 : 1
    const [tokenId, verifier] = cryptoVersion === 2 ? parts.slice(1) : parts

    if (!tokenId || !verifier || (cryptoVersion === 1 && parts.length !== 2)) {
      return response.unauthorized('Invalid token format')
    }

    if (cryptoVersion === 1 && !legacyTokensAllowed()) {
      return response.unauthorized('Legacy tokens are disabled on this server. Please recreate your token.')
    }

    const token = await ProjectToken.query()
      .where('id', tokenId)
      .andWhere('crypto_version', cryptoVersion)
      .andWhere((q) => {
        q.whereNull('expires_at').orWhere('expires_at', '>', DateTime.now().toSQL())
      })
      .first()

    const denied = async (message: string) => {
      await audit({ auth, request }, 'tokens.use.denied', {
        actor: { type: 'token', id: tokenId, label: token?.name ?? 'unknown token' },
        projectId: token?.projectId,
        environment: token?.environment,
      })
      return response.unauthorized(message)
    }

    if (!token) return denied('Token not found')

    const isValid = await hash.verify(token.token, verifier)
    if (!isValid) return denied('Invalid secret')

    const snapshot = await snapshotsOf(token.projectId, token.environment)
      .orderBy('version', 'desc')
      .first()

    if (!snapshot) return response.notFound('No secrets')

    await audit({ auth, request }, 'tokens.use', {
      actor: { type: 'token', id: token.id, label: token.name },
      projectId: token.projectId,
      environment: token.environment,
      details: { version: snapshot.version },
    })

    return response.ok({
      cryptoVersion: token.cryptoVersion,
      encryptedProjectKey: token.encryptedProjectKey,
      secrets: {
        ciphertext: snapshot.ciphertext,
        iv: snapshot.iv,
        authTag: snapshot.authTag,
        cryptoVersion: snapshot.cryptoVersion,
        version: snapshot.version,
        environment: snapshot.environment,
        projectId: snapshot.projectId,
      },
    })
  }
}
