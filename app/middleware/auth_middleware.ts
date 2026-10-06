import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'

export default class AuthMiddleware {
  redirectTo = '/login'

  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    const user = await ctx.auth.authenticateUsing(options.guards, { loginRoute: this.redirectTo })
    if (user.deletedAt) {
      return ctx.response.unauthorized({ message: 'Account has been deleted' })
    }
    return next()
  }
}
