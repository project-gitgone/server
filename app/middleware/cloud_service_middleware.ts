import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { SERVICE_SUBJECT_PREFIX, verifiedCloudToken } from '#auth/cloud_guard'

export default class CloudServiceMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { scope: string }) {
    const payload = await verifiedCloudToken(ctx)
    if (!payload) return ctx.response.unauthorized({ message: 'Unauthorized access' })
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : []
    if (!payload.sub.startsWith(SERVICE_SUBJECT_PREFIX) || !scopes.includes(options.scope)) {
      return ctx.response.forbidden({ message: 'This token cannot do that' })
    }
    return next()
  }
}
