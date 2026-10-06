import { revokeLostKeys } from '#services/keyring'
import { audit } from '#services/audit'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Project from '#models/project'
import Environment from '#models/environment'
import { permit, see } from '#abilities/main'
import { findEnvironment } from '#services/environments'
import { defaultProtection } from '#services/rbac/environments'
import { createEnvironmentValidator, updateEnvironmentValidator } from '#validators/environment'

async function managedProject({ params, bouncer, response }: HttpContext) {
  const project = await Project.findOrFail(params.id)
  if (await bouncer.denies(permit, 'project.environments.manage', { project })) {
    response.forbidden({ message: 'You cannot manage the environments of this project' })
    return null
  }
  return project
}

const canUnprotect = ({ bouncer }: HttpContext, project: Project, name: string) =>
  bouncer.allows(permit, 'env.write', { project, environment: { name, protected: true } })

export default class EnvironmentsController {
  async index({ params, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.id)
    if (await bouncer.denies(see, { project }))
      return response.forbidden({ message: 'Access denied' })

    const environments = await Environment.query().where('project_id', project.id).orderBy('name')
    const stats = await db
      .from('secret_snapshots')
      .where('project_id', project.id)
      .groupBy('environment')
      .select('environment')
      .count('* as total')
      .max('created_at as last_push_at')
    const byName = new Map(stats.map((s) => [s.environment, s]))

    return response.ok(
      environments.map((environment) => ({
        ...environment.serialize(),
        snapshotCount: Number(byName.get(environment.name)?.total ?? 0),
        lastPushAt: byName.get(environment.name)?.last_push_at ?? null,
      }))
    )
  }

  async store(ctx: HttpContext) {
    const { request, auth, response } = ctx
    const project = await managedProject(ctx)
    if (!project) return
    const payload = await request.validateUsing(createEnvironmentValidator)
    if (await findEnvironment(project.id, payload.name)) {
      return response.conflict({ message: 'This environment already exists' })
    }
    const isProtected = payload.protected ?? defaultProtection(payload.name)
    if (
      !isProtected &&
      defaultProtection(payload.name) &&
      !(await canUnprotect(ctx, project, payload.name))
    ) {
      return response.forbidden({ message: `You cannot create "${payload.name}" unprotected` })
    }
    const environment = await Environment.create({
      projectId: project.id,
      name: payload.name,
      protected: isProtected,
      retention: payload.retention ?? null,
    })
    await audit({ auth, request }, 'environments.create', {
      projectId: project.id,
      environment: environment.name,
      details: { protected: environment.protected, retention: environment.retention },
    })
    return response.created(environment)
  }

  async update(ctx: HttpContext) {
    const { params, request, auth, response } = ctx
    const project = await managedProject(ctx)
    if (!project) return
    const environment = await Environment.query()
      .where('id', params.environmentId)
      .where('project_id', project.id)
      .firstOrFail()
    const payload = await request.validateUsing(updateEnvironmentValidator)
    if (
      payload.protected === false &&
      environment.protected &&
      !(await canUnprotect(ctx, project, environment.name))
    ) {
      return response.forbidden({ message: `You cannot unprotect "${environment.name}"` })
    }
    environment.merge({
      ...(payload.protected !== undefined ? { protected: payload.protected } : {}),
      ...(payload.retention !== undefined ? { retention: payload.retention } : {}),
    })
    await environment.save()
    await audit({ auth, request }, 'environments.update', {
      projectId: project.id,
      environment: environment.name,
      details: { protected: environment.protected, retention: environment.retention },
    })
    const revoked = payload.protected !== undefined ? await revokeLostKeys([project]) : {}
    return response.ok({ ...environment.serialize(), ...revoked })
  }
}
