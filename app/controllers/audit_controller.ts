import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Project from '#models/project'
import AuditEvent from '#models/audit_event'
import { permit } from '#abilities/main'
import { auditQueryValidator } from '#validators/audit'

export default class AuditController {
  async index({ request, bouncer, response }: HttpContext) {
    const filters = await auditQueryValidator.validate(request.qs())

    if (filters.projectId) {
      const project = await Project.findOrFail(filters.projectId)
      if (await bouncer.denies(permit, 'project.audit.read', { project })) {
        return response.forbidden({ message: 'You cannot read the audit of this project' })
      }
    } else if (await bouncer.denies(permit, 'instance.audit.read')) {
      return response.forbidden({ message: 'You cannot read the audit of the instance' })
    }

    const query = AuditEvent.query().orderBy('created_at', 'desc')
    if (filters.projectId) query.where('project_id', filters.projectId)
    if (filters.action) query.where('action', filters.action)
    if (filters.actorId) query.where('actor_id', filters.actorId)
    if (filters.from) query.where('created_at', '>=', DateTime.fromJSDate(filters.from).toSQL()!)
    if (filters.to) query.where('created_at', '<=', DateTime.fromJSDate(filters.to).toSQL()!)

    return response.ok(await query.paginate(filters.page ?? 1, filters.limit ?? 50))
  }
}
