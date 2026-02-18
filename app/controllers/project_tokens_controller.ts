import type { HttpContext } from '@adonisjs/core/http'
import Project from '#models/project'
import ProjectToken from '#models/project_token'
import SecretSnapshot from '#models/secret_snapshot'
import ProjectPolicy from '#policies/project_policy'
import { createProjectTokenValidator } from '#validators/project_token'
import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'

export default class ProjectTokensController {
  async index({ params, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.projectId)
    if (await bouncer.with(ProjectPolicy).denies('edit', project)) {
      return response.forbidden('You do not have access to this project')
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

    if (await bouncer.with(ProjectPolicy).denies('manageTokens', project)) {
      return response.forbidden('You do not have permission to create tokens for this project')
    }

    const payload = await request.validateUsing(createProjectTokenValidator)

    const token = await ProjectToken.create({
      name: payload.name,
      token: await hash.make(payload.tokenSecretHash),
      projectId: project.id,
      environment: payload.environment,
      encryptedProjectKey: payload.encryptedProjectKey,
      createdBy: user.id,
      expiresAt: payload.expiresAt ? DateTime.fromISO(payload.expiresAt) : null,
    })

    return response.created(token)
  }

  async destroy({ params, bouncer, response }: HttpContext) {
    const token = await ProjectToken.findOrFail(params.id)
    const project = await Project.findOrFail(token.projectId)

    if (await bouncer.with(ProjectPolicy).denies('manageTokens', project)) {
      return response.forbidden('You do not have permission to delete tokens for this project')
    }

    await token.delete()
    return response.noContent()
  }

  async getEnv({ request, response }: HttpContext) {
    const authHeader = request.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return response.unauthorized('Missing token')
    }

    const fullToken = authHeader.substring(7)
    const [tokenId, tokenSecret] = fullToken.split('.')

    if (!tokenId || !tokenSecret) {
      return response.unauthorized('Invalid token format')
    }

    const token = await ProjectToken.query()
      .where('id', tokenId)
      .andWhere((q) => {
        q.whereNull('expires_at').orWhere('expires_at', '>', DateTime.now().toSQL())
      })
      .first()

    if (!token) return response.unauthorized('Token not found')

    const isValid = await hash.verify(token.token, tokenSecret)
    if (!isValid) return response.unauthorized('Invalid secret')

    const snapshot = await SecretSnapshot.query()
      .where('project_id', token.projectId)
      .andWhere('environment', token.environment)
      .orderBy('version', 'desc')
      .first()

    if (!snapshot) return response.notFound('No secrets')

    return response.ok({
      encryptedProjectKey: token.encryptedProjectKey,
      secrets: {
        ciphertext: snapshot.ciphertext,
        iv: snapshot.iv,
        authTag: snapshot.authTag,
      },
    })
  }
}
