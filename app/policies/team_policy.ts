import User from '#models/user'
import Team from '#models/team'
import { BasePolicy } from '@adonisjs/bouncer'
import { AuthorizerResponse } from '@adonisjs/bouncer/types'

export default class TeamPolicy extends BasePolicy {
  async view(user: User, team: Team): Promise<AuthorizerResponse> {
    if (user.systemRole === 'SUPERADMIN') return true

    const membership = await team.related('members').query().where('user_id', user.id).first()
    return !!membership
  }

  async manage(user: User, team: Team): Promise<AuthorizerResponse> {
    if (user.systemRole === 'SUPERADMIN') return true

    const membership = await team.related('members').query().where('user_id', user.id).first()
    return membership?.role === 'OWNER'
  }
}
