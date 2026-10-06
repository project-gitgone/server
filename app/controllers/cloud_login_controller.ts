import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { GitGoneCloudDriver } from '#auth/gitgone_cloud_driver'
import User from '#models/user'
import { audit } from '#services/audit'
import { cloudLoginConfig } from '#services/cloud'
import {
  CloudLoginDeniedError,
  completeCloudLogin,
  issueLoginCode,
  redeemLoginCode,
} from '#services/cloud_login'
import { cloudExchangeValidator, cloudLoginValidator } from '#validators/auth'

const NETWORK_ERRORS = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
])

const isUnreachable = (error: unknown) => {
  const code =
    (error as { code?: string; cause?: { code?: string } })?.cause?.code ??
    (error as { code?: string })?.code
  return !!code && NETWORK_ERRORS.has(code)
}

const CLI_REQUEST_COOKIE = 'gitgone_cli_login'

type CliRequest = { port: number; state: string; codeChallenge: string }

const cliCallback = (cli: CliRequest, params: Record<string, string>) =>
  `http://127.0.0.1:${cli.port}/callback?${new URLSearchParams({ ...params, state: cli.state })}`

function driver(ctx: HttpContext) {
  const config = cloudLoginConfig()
  return config ? new GitGoneCloudDriver(ctx, config) : null
}

export default class CloudLoginController {
  async login(ctx: HttpContext) {
    const cloud = driver(ctx)
    if (!cloud) return ctx.response.notFound({ message: 'Not found' })
    const payload = await cloudLoginValidator.validate(ctx.request.qs())
    const cli: CliRequest = {
      port: payload.port,
      state: payload.state,
      codeChallenge: payload.code_challenge,
    }
    ctx.response.encryptedCookie(CLI_REQUEST_COOKIE, cli, {
      sameSite: 'lax',
      httpOnly: true,
      maxAge: '10m',
    })
    return cloud.redirect()
  }

  async callback(ctx: HttpContext) {
    const { request, response, auth } = ctx
    const cloud = driver(ctx)
    if (!cloud) return response.notFound({ message: 'Not found' })
    const cli = request.encryptedCookie(CLI_REQUEST_COOKIE) as CliRequest | null
    response.clearCookie(CLI_REQUEST_COOKIE)
    if (!cli)
      return response.badRequest({ message: 'Login request expired. Run "gitgone login" again.' })

    if (cloud.accessDenied() || cloud.stateMisMatch() || cloud.hasError()) {
      return response.redirect(cliCallback(cli, { error: 'access_denied' }))
    }

    try {
      const { profile } = await cloud.user()
      const user = await completeCloudLogin(profile)
      const code = await issueLoginCode(user, cli.codeChallenge)
      await audit({ auth, request }, 'auth.login', {
        actor: { type: 'user', id: user.id, label: user.email },
        details: { via: 'cloud' },
      })
      return response.redirect(cliCallback(cli, { code }))
    } catch (error) {
      logger.error({ err: error }, 'Cloud login failed')
      await audit({ auth, request }, 'auth.login.failed', {
        actor: { type: 'user', id: 'unknown', label: 'cloud' },
        details: { via: 'cloud' },
      })
      const message =
        error instanceof CloudLoginDeniedError
          ? error.message
          : isUnreachable(error)
            ? 'GitGone Cloud is unreachable from this instance'
            : 'Login failed'
      return response.redirect(
        cliCallback(cli, { error: 'access_denied', error_description: message })
      )
    }
  }

  async exchange({ request, response }: HttpContext) {
    const { code, codeVerifier } = await request.validateUsing(cloudExchangeValidator)
    const user = await redeemLoginCode(code, codeVerifier)
    const token = await User.accessTokens.create(user)
    return response.ok({ token, user: user.toAuthJSON() })
  }
}
