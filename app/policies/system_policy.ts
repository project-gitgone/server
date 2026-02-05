import User from '#models/user'
import { BasePolicy } from '@adonisjs/bouncer'
import { AuthorizerResponse } from '@adonisjs/bouncer/types'

export default class SystemPolicy extends BasePolicy {
  manage(user: User): AuthorizerResponse {
    return user.systemRole === 'SUPERADMIN'
  }
}
