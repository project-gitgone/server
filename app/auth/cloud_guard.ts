import type { HttpContext } from '@adonisjs/core/http'
import { errors, symbols } from '@adonisjs/auth'
import type { AuthClientResponse, GuardContract } from '@adonisjs/auth/types'
import type User from '#models/user'
import { userOfCloudSubject } from '#services/accounts'
import { verifyCloudToken, type CloudTokenPayload } from '#services/cloud_jwt'

export const SERVICE_SUBJECT_PREFIX = 'cloud:'

export function bearerToken(ctx: HttpContext) {
  const header = ctx.request.header('authorization')
  return header?.startsWith('Bearer ') ? header.slice(7) : null
}

export async function verifiedCloudToken(ctx: HttpContext): Promise<CloudTokenPayload | null> {
  const token = bearerToken(ctx)
  if (!token) return null
  try {
    return await verifyCloudToken(token)
  } catch {
    return null
  }
}

export class CloudGuard implements GuardContract<User> {
  declare [symbols.GUARD_KNOWN_EVENTS]: {}

  readonly driverName = 'cloud' as const
  authenticationAttempted = false
  isAuthenticated = false
  user?: User

  constructor(private ctx: HttpContext) {}

  #unauthorized(): never {
    throw new errors.E_UNAUTHORIZED_ACCESS('Unauthorized access', { guardDriverName: this.driverName })
  }

  async authenticate() {
    if (this.authenticationAttempted) return this.getUserOrFail()
    this.authenticationAttempted = true

    const payload = await verifiedCloudToken(this.ctx)
    if (!payload || payload.sub.startsWith(SERVICE_SUBJECT_PREFIX)) this.#unauthorized()

    const user = await userOfCloudSubject(payload.sub, { active: true })
    if (!user) this.#unauthorized()

    this.user = user
    this.isAuthenticated = true
    return user
  }

  async check() {
    try {
      await this.authenticate()
      return true
    } catch {
      return false
    }
  }

  getUserOrFail() {
    if (!this.user) this.#unauthorized()
    return this.user
  }

  async authenticateAsClient(): Promise<AuthClientResponse> {
    throw new Error('Cloud tokens are issued by GitGone Cloud')
  }
}
