import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { permit, see } from '#abilities/main'
import Environment from '#models/environment'
import Project from '#models/project'
import { projectTimeline } from '#services/timeline'
import { timelineValidator } from '#validators/timeline'

export default class TimelineController {
  async show({ params, request, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.id)
    if (await bouncer.denies(see, { project }))
      return response.forbidden({ message: 'Access denied' })

    const { limit, before } = await request.validateUsing(timelineValidator, { data: request.qs() })
    const visible: string[] = []
    for (const environment of await Environment.query()
      .where('project_id', project.id)
      .orderBy('name')) {
      if (await bouncer.allows(permit, 'env.history.read', { project, environment })) {
        visible.push(environment.name)
      }
    }

    return response.ok(
      await projectTimeline(project.id, visible, {
        limit: limit ?? 50,
        before: before ? DateTime.fromJSDate(before) : undefined,
      })
    )
  }
}
