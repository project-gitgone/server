import { auditAccess } from '#services/audit'
import type { HttpContext } from '@adonisjs/core/http'
import Project from '#models/project'
import Team from '#models/team'
import User from '#models/user'
import { permit, see } from '#abilities/main'
import { removeRole, setRole } from '#services/rbac/assignments'
import { revokeLostKeys } from '#services/keyring'
import { projectAssignments } from '#services/rbac/permission_resolver'
import { serializeMember } from '#controllers/workspace_controller'
import { assignRoleValidator, projectMemberValidator } from '#validators/member'

export default class MembersController {
  async setInstanceRole({ params, request, auth, bouncer, response }: HttpContext) {
    if (await bouncer.denies(permit, 'instance.users.manage')) {
      return response.forbidden({ message: 'You are not authorized to manage users' })
    }
    const target = await User.query().where('id', params.id).whereNull('deleted_at').firstOrFail()
    const { roleId } = await request.validateUsing(assignRoleValidator)
    await setRole(target.id, roleId, { type: 'instance' }, auth.getUserOrFail())
    await auditAccess({ auth, request }, 'access.grant', { userId: target.id, scope: { type: 'instance' }, roleId })
    return response.ok({ userId: target.id, roleId })
  }

  async setTeamRole({ params, request, auth, bouncer, response }: HttpContext) {
    const team = await Team.findOrFail(params.id)
    if (await bouncer.denies(permit, 'team.members.manage', { teamId: team.id })) {
      return response.forbidden({ message: 'You are not authorized to manage this team' })
    }
    const isMember = await team.related('members').query().where('user_id', params.userId).first()
    if (!isMember) return response.notFound({ message: 'This user is not a member of the team' })

    const { roleId } = await request.validateUsing(assignRoleValidator)
    const member = await setRole(
      params.userId,
      roleId,
      { type: 'team', id: team.id },
      auth.getUserOrFail()
    )
    await member.load('user')
    await member.load('role')
    const projects = await Project.query().where('team_id', team.id)
    await auditAccess({ auth, request }, 'access.grant', {
      userId: params.userId,
      scope: { type: 'team', id: team.id },
      roleId,
    })
    return response.ok({
      member: serializeMember(member),
      ...(await revokeLostKeys(projects, params.userId)),
    })
  }

  async listProjectMembers({ params, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.id)
    if (await bouncer.denies(see, { project }))
      return response.forbidden({ message: 'Access denied' })

    const assignments = await projectAssignments(project).preload('user')
    return response.ok(assignments.map((a) => ({ source: a.scopeType, ...serializeMember(a) })))
  }

  async setProjectRole({ params, request, auth, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.id)
    if (await bouncer.denies(permit, 'project.members.manage', { project })) {
      return response.forbidden({ message: 'You are not authorized to manage this project' })
    }
    const payload = await request.validateUsing(projectMemberValidator)
    const user = await User.query().where('email', payload.email).whereNull('deleted_at').first()
    if (!user) return response.notFound({ message: 'User not found' })

    const member = await setRole(
      user.id,
      payload.roleId,
      { type: 'project', id: project.id },
      auth.getUserOrFail()
    )
    await member.load('user')
    await member.load('role')
    await auditAccess({ auth, request }, 'access.grant', {
      userId: user.id,
      scope: { type: 'project', id: project.id },
      roleId: payload.roleId,
    })
    return response.ok({
      member: serializeMember(member),
      ...(await revokeLostKeys([project], user.id)),
    })
  }

  async removeProjectRole({ params, request, auth, bouncer, response }: HttpContext) {
    const project = await Project.findOrFail(params.id)
    if (await bouncer.denies(permit, 'project.members.manage', { project })) {
      return response.forbidden({ message: 'You are not authorized to manage this project' })
    }
    await removeRole(params.userId, { type: 'project', id: project.id })
    await auditAccess({ auth, request }, 'access.revoke', {
      userId: params.userId,
      scope: { type: 'project', id: project.id },
    })
    return response.ok(await revokeLostKeys([project], params.userId))
  }
}
