import User from '#models/user'
import Project from '#models/project'
import { BasePolicy } from '@adonisjs/bouncer'
import { AuthorizerResponse } from '@adonisjs/bouncer/types'

export default class ProjectPolicy extends BasePolicy {
  async view(user: User, project: Project): Promise<AuthorizerResponse> {
    if (user.systemRole === 'SUPERADMIN') return true

    await project.load('team')
    const membership = await project.team.related('members').query().where('user_id', user.id).first()
    return !!membership
  }

  async edit(user: User, project: Project): Promise<AuthorizerResponse> {
    if (user.systemRole === 'SUPERADMIN') return true

    await project.load('team')
    const membership = await project.team.related('members').query().where('user_id', user.id).first()
    return !!membership
  }
}
