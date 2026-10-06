import { audit, auditAccess } from '#services/audit'
import { revokeLostKeys } from '#services/keyring'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Team from '#models/team'
import Project from '#models/project'
import Environment from '#models/environment'
import { PERMISSIONS, permissionLevel, type PermissionLevel } from '#services/rbac/permissions'
import User from '#models/user'
import RoleAssignment from '#models/role_assignment'
import { permit, see } from '#abilities/main'
import PermissionResolver from '#services/rbac/permission_resolver'
import { defaultRoleId } from '#services/rbac/default_roles'
import {
  findAssignment,
  removeRole,
  roleIdFromInput,
  setRole,
} from '#services/rbac/assignments'
import {
  addMemberValidator,
  createProjectValidator,
  createTeamValidator,
  updateProjectValidator,
} from '#validators/workspace'

export const serializeMember = (assignment: RoleAssignment) => ({
  userId: assignment.userId,
  roleId: assignment.roleId,
  role: assignment.role.name,
  roleKey: assignment.role.key,
  user: {
    id: assignment.user.id,
    email: assignment.user.email,
    fullName: assignment.user.fullName,
  },
})

const permissionsOfLevel = (level: PermissionLevel) => PERMISSIONS.filter((p) => permissionLevel(p) === level)

export default class WorkspaceController {
  async createTeam({ request, auth, bouncer, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (await bouncer.denies(permit, 'instance.teams.create')) {
      return response.forbidden({ message: 'You are not allowed to create teams' })
    }
    const payload = await request.validateUsing(createTeamValidator)

    const team = await db.transaction(async (trx) => {
      const created = await Team.create({ name: payload.name }, { client: trx })
      await RoleAssignment.create(
        {
          userId: user.id,
          roleId: defaultRoleId('maintainer'),
          scopeType: 'team',
          scopeId: created.id,
        },
        { client: trx }
      )
      return created
    })
    await audit({ auth, request }, 'teams.create', { targetType: 'team', targetId: team.id })
    return response.created(team)
  }

  async addMember({ request, params, auth, bouncer, response }: HttpContext) {
    const team = await Team.findOrFail(params.id)
    if (await bouncer.denies(permit, 'team.members.manage', { teamId: team.id })) {
      return response.forbidden({ message: 'You are not authorized to manage this team' })
    }
    const payload = await request.validateUsing(addMemberValidator)

    const userToAdd = await User.query()
      .where('email', payload.email)
      .whereNull('deleted_at')
      .first()
    if (!userToAdd) return response.notFound({ message: 'User not found' })

    const existing = await findAssignment(userToAdd.id, { type: 'team', id: team.id })
    if (existing) return response.badRequest({ message: 'User is already a member of this team' })

    const assignment = await setRole(
      userToAdd.id,
      roleIdFromInput(payload, 'workspace'),
      { type: 'team', id: team.id },
      auth.getUserOrFail()
    )
    await assignment.load('user')
    await assignment.load('role')
    await auditAccess({ auth, request }, 'access.grant', {
      userId: userToAdd.id,
      scope: { type: 'team', id: team.id },
      roleId: assignment.roleId,
    })
    return response.created(serializeMember(assignment))
  }

  async removeMember({ params, request, auth, bouncer, response }: HttpContext) {
    const team = await Team.findOrFail(params.id)
    if (await bouncer.denies(permit, 'team.members.manage', { teamId: team.id })) {
      return response.forbidden({ message: 'You are not authorized to manage this team' })
    }
    await removeRole(params.userId, { type: 'team', id: team.id })
    await auditAccess({ auth, request }, 'access.revoke', {
      userId: params.userId,
      scope: { type: 'team', id: team.id },
    })
    const projects = await Project.query().where('team_id', team.id)
    return response.ok(await revokeLostKeys(projects, params.userId))
  }

  async listMembers({ params, bouncer, response }: HttpContext) {
    const team = await Team.findOrFail(params.id)
    if (await bouncer.denies(see, { teamId: team.id })) {
      return response.forbidden({ message: 'You are not authorized to view this team' })
    }
    const members = await team.related('members').query().preload('user').preload('role')
    return response.ok(members.map(serializeMember))
  }

  async createProject({ request, params, auth, bouncer, response }: HttpContext) {
    const team = await Team.findOrFail(params.id)
    if (await bouncer.denies(permit, 'team.projects.create', { teamId: team.id })) {
      return response.forbidden('You are not authorized to create projects in this team')
    }
    const payload = await request.validateUsing(createProjectValidator)
    const project = await Project.create({ name: payload.name, teamId: team.id })
    await audit({ auth, request }, 'projects.create', { projectId: project.id })
    return response.created(project)
  }

  async updateProject({ request, params, auth, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.id)
    if (await bouncer.denies(permit, 'project.manage', { project })) {
      return response.forbidden({ message: 'Access denied' })
    }
    const payload = await request.validateUsing(updateProjectValidator)
    project.merge(payload)
    await project.save()
    await audit({ auth, request }, 'projects.update', { projectId: project.id, details: payload })
    return response.ok(project)
  }

  async showProject({ params, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.id)
    if (await bouncer.denies(see, { project })) {
      return response.forbidden({ message: 'Access denied' })
    }
    return response.ok(project)
  }

  async listTeams({ auth, response }: HttpContext) {
    const visibility = await PermissionResolver.for(auth.getUserOrFail()).projectVisibility()
    const query = Team.query().orderBy('name')
    if (!visibility.all) {
      query.where((q) =>
        q
          .whereIn('id', visibility.teamIds)
          .orWhereIn('id', Project.query().whereIn('id', visibility.projectIds).select('team_id'))
      )
    }
    const resolver = PermissionResolver.for(auth.getUserOrFail())
    const teams = await query
    return response.ok(
      await Promise.all(
        teams.map(async (team) => ({
          ...team.serialize(),
          permissions: await resolver.permissionsOn({ teamId: team.id }, permissionsOfLevel('team')),
        }))
      )
    )
  }

  async projectPermissions({ params, auth, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.id)
    if (await bouncer.denies(see, { project })) {
      return response.forbidden({ message: 'Access denied' })
    }
    const resolver = PermissionResolver.for(auth.getUserOrFail())
    const environments = await Environment.query().where('project_id', project.id)
    return response.ok({
      project: await resolver.permissionsOn({ project }, [
        ...permissionsOfLevel('team'),
        ...permissionsOfLevel('project'),
      ]),
      environments: Object.fromEntries(
        await Promise.all(
          environments.map(async (environment) => [
            environment.name,
            await resolver.permissionsOn(
              { project, environment: { name: environment.name, protected: environment.protected } },
              permissionsOfLevel('env')
            ),
          ])
        )
      ),
    })
  }

  async listProjects({ auth, response }: HttpContext) {
    const visibility = await PermissionResolver.for(auth.getUserOrFail()).projectVisibility()
    const query = Project.query().preload('team')
    if (!visibility.all) {
      query.where((q) =>
        q.whereIn('team_id', visibility.teamIds).orWhereIn('id', visibility.projectIds)
      )
    }
    return response.ok(await query)
  }
}
