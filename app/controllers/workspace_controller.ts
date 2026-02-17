import type { HttpContext } from '@adonisjs/core/http'
import Team from '#models/team'
import TeamMember from '#models/team_member'
import Project from '#models/project'
import User from '#models/user'
import TeamPolicy from '#policies/team_policy'
import ProjectPolicy from '#policies/project_policy'
import {
  addMemberValidator,
  createProjectValidator,
  createTeamValidator,
  updateProjectValidator,
} from '#validators/workspace'

export default class WorkspaceController {
  async createTeam({ request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(createTeamValidator)

    const team = await Team.create({ name: payload.name })

    await TeamMember.create({
      userId: user.id,
      teamId: team.id,
      role: 'OWNER',
    })

    return response.created(team)
  }

  async addMember({ request, params, bouncer, response }: HttpContext) {
    const team = await Team.findOrFail(params.id)

    if (await bouncer.with(TeamPolicy).denies('manage', team)) {
      return response.forbidden({ message: 'You are not authorized to manage this team' })
    }

    const payload = await request.validateUsing(addMemberValidator)

    const userToAdd = await User.findBy('email', payload.email)
    if (!userToAdd) {
      return response.notFound({ message: 'User not found' })
    }

    const existing = await TeamMember.query()
      .where('team_id', team.id)
      .andWhere('user_id', userToAdd.id)
      .first()

    if (existing) {
      return response.badRequest({ message: 'User is already a member of this team' })
    }

    const member = await TeamMember.create({
      teamId: team.id,
      userId: userToAdd.id,
      role: payload.role || 'MEMBER',
    })

    return response.created(member)
  }

  async listMembers({ params, bouncer, response }: HttpContext) {
    const team = await Team.findOrFail(params.id)

    if (await bouncer.with(TeamPolicy).denies('view', team)) {
      return response.forbidden({ message: 'You are not authorized to view this team' })
    }

    const members = await TeamMember.query()
      .where('team_id', team.id)
      .preload('user', (q) => q.select('id', 'email', 'full_name'))

    return response.ok(members)
  }

  async createProject({ request, params, bouncer, response }: HttpContext) {
    const team = await Team.findOrFail(params.id)

    if (await bouncer.with(TeamPolicy).denies('manage', team)) {
      return response.forbidden('You are not authorized to create projects in this team')
    }

    const payload = await request.validateUsing(createProjectValidator)

    const project = await Project.create({
      name: payload.name,
      teamId: team.id,
    })

    return response.created(project)
  }

  async updateProject({ request, params, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.id)

    if (await bouncer.with(ProjectPolicy).denies('edit', project)) {
      return response.forbidden({ message: 'Access denied' })
    }

    const payload = await request.validateUsing(updateProjectValidator)

    project.merge(payload)
    await project.save()

    return response.ok(project)
  }

  async showProject({ params, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.id)

    if (await bouncer.with(ProjectPolicy).denies('view', project)) {
      return response.forbidden({ message: 'Access denied' })
    }

    return response.ok(project)
  }

  async listProjects({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    if (user.systemRole === 'SUPERADMIN') {
      const projects = await Project.query().preload('team')
      return response.ok(projects)
    }

    const projects = await Project.query()
      .whereIn('team_id', (subquery) => {
        subquery.select('team_id').from('team_members').where('user_id', user.id)
      })
      .preload('team')

    return response.ok(projects)
  }
}
