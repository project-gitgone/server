import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { cloudConfig } from '#services/cloud'

export default class CloudOnlyMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (!cloudConfig()) return ctx.response.notFound({ message: 'Not found' })
    return next()
  }
}
