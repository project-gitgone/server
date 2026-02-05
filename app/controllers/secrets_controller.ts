import type { HttpContext } from '@adonisjs/core/http'
import Project from '#models/project'
import SecretSnapshot from '#models/secret_snapshot'
import ProjectPolicy from '#policies/project_policy'
import { pushSecretValidator } from '#validators/secret'

export default class SecretsController {

  async push({ request, auth, bouncer, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(pushSecretValidator)

    const project = await Project.findOrFail(payload.projectId)

    if (await bouncer.with(ProjectPolicy).denies('edit', project)) {
      return response.forbidden('You do not have write access to this project')
    }

    const lastSnapshot = await SecretSnapshot.query()
      .where('project_id', project.id)
      .andWhere('environment', payload.environment)
      .orderBy('version', 'desc')
      .first()

    const nextVersion = (lastSnapshot?.version || 0) + 1

    const snapshot = await SecretSnapshot.create({
      projectId: project.id,
      environment: payload.environment,
      version: nextVersion,
      ciphertext: payload.encryptedData.ciphertext,
      iv: payload.encryptedData.iv,
      authTag: payload.encryptedData.authTag,
      createdBy: user.id,
    })

    return response.created(snapshot)
  }


  async latest({ request, bouncer, response }: HttpContext) {
    const qs = request.qs()
    if (!qs.projectId || !qs.env) {
      return response.badRequest({ message: 'Missing projectId or env query parameters' })
    }

    const project = await Project.findOrFail(qs.projectId)

    if (await bouncer.with(ProjectPolicy).denies('view', project)) {
      return response.forbidden({ message: 'You do not have read access to this project' })
    }

    if (project.disallowPull && qs.mode !== 'memory') {
        return response.forbidden({ message: 'This project is configured for memory-only injection. Pull is disabled.' })
    }

    const snapshot = await SecretSnapshot.query()
      .where('project_id', project.id)
      .andWhere('environment', qs.env)
      .orderBy('version', 'desc')
      .first()

    if (!snapshot) {
      return response.notFound({ message: 'No secrets found for this environment' })
    }

    return response.ok({
      ciphertext: snapshot.ciphertext,
      iv: snapshot.iv,
      tag: snapshot.authTag,
      version: snapshot.version,
    })
  }

  async history({ request, bouncer, response }: HttpContext) {
    const qs = request.qs()
    if (!qs.projectId || !qs.env) {
      return response.badRequest('Missing projectId or env query parameters')
    }

    try {
      const project = await Project.findOrFail(qs.projectId)

      if (await bouncer.with(ProjectPolicy).denies('view', project)) {
        return response.forbidden('You do not have read access to this project')
      }

      const history = await SecretSnapshot.query()
        .where('project_id', project.id)
        .andWhere('environment', qs.env)
        .orderBy('version', 'desc')
        .preload('creator', (q) => q.select('id', 'email', 'full_name'))
        .select('id', 'version', 'created_at', 'created_by')

        if(history.length === 0) {
          return response.notFound('No secret history found for this environment')
        }

      return response.ok(history)
    } catch (error) {
      throw error;
    }
  }


  async getVersion({ params, bouncer, response }: HttpContext) {
    const snapshot = await SecretSnapshot.findOrFail(params.id)
    await snapshot.load('project')

    if (await bouncer.with(ProjectPolicy).denies('view', snapshot.project)) {
      return response.forbidden('You do not have read access to this project')
    }

    return response.ok({
      ciphertext: snapshot.ciphertext,
      iv: snapshot.iv,
      tag: snapshot.authTag,
      version: snapshot.version,
      environment: snapshot.environment,
    })
  }
}
