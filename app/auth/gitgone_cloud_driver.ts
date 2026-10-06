import type { HttpContext } from '@adonisjs/core/http'
import { Oauth2Driver, type ApiRequest } from '@adonisjs/ally'
import type {
  AllyUserContract,
  ApiRequestContract,
  Oauth2AccessToken,
  RedirectRequestContract,
} from '@adonisjs/ally/types'
import type { CloudProfile } from '#services/cloud_login'

export type GitGoneCloudConfig = {
  issuer: string
  clientId: string
  clientSecret: string
  callbackUrl: string
}

const VERIFIER_COOKIE = 'gitgone_cloud_pkce'

export class GitGoneCloudDriver extends Oauth2Driver<Oauth2AccessToken, 'openid' | 'profile' | 'email'> {
  protected authorizeUrl: string
  protected accessTokenUrl: string
  protected userInfoUrl: string
  protected codeParamName = 'code'
  protected errorParamName = 'error'
  protected stateCookieName = 'gitgone_cloud_state'
  protected stateParamName = 'state'
  protected scopeParamName = 'scope'
  protected scopesSeparator = ' '

  #codeVerifier: string | null = null

  constructor(
    ctx: HttpContext,
    public config: GitGoneCloudConfig
  ) {
    super(ctx, config)
    const base = `${config.issuer}/api/auth/oauth2`
    this.authorizeUrl = `${base}/authorize`
    this.accessTokenUrl = `${base}/token`
    this.userInfoUrl = `${base}/userinfo`
    this.loadState()
  }

  protected getPkceCodeVerifierForRedirect() {
    this.#codeVerifier = this.makeCodeVerifier()
    this.ctx.response.encryptedCookie(VERIFIER_COOKIE, this.#codeVerifier, {
      sameSite: 'lax',
      httpOnly: true,
    })
    return this.#codeVerifier
  }

  protected getPkceCodeVerifierForAccessToken() {
    const verifier = this.ctx.request.encryptedCookie(VERIFIER_COOKIE)
    this.ctx.response.clearCookie(VERIFIER_COOKIE)
    return typeof verifier === 'string' ? verifier : null
  }

  protected configureRedirectRequest(request: RedirectRequestContract<'openid' | 'profile' | 'email'>) {
    request.scopes(['openid', 'profile', 'email'])
    request.param('response_type', 'code')
  }

  accessDenied() {
    return this.getError() === 'access_denied'
  }

  async user(callback?: (request: ApiRequestContract) => void) {
    const token = await this.accessToken(callback)
    return { ...(await this.userFromToken(token.token, callback)), token }
  }

  async userFromToken(
    token: string,
    callback?: (request: ApiRequestContract) => void
  ): Promise<AllyUserContract<{ token: string; type: 'bearer' }> & { profile: CloudProfile }> {
    const request: ApiRequest = this.httpClient(this.userInfoUrl)
    request.header('Authorization', `Bearer ${token}`)
    request.header('Accept', 'application/json')
    request.parseAs('json')
    if (callback) callback(request)
    const body = await request.get()
    return {
      id: body.sub,
      name: body.name ?? null,
      nickName: body.name ?? null,
      email: body.email ?? null,
      emailVerificationState: body.email_verified ? 'verified' : 'unverified',
      avatarUrl: body.picture ?? null,
      original: body,
      token: { token, type: 'bearer' },
      profile: {
        subject: String(body.sub),
        email: typeof body.email === 'string' ? body.email : '',
        name: body.name ?? null,
        emailVerified: body.email_verified === true,
        organization: body.gitgone_organization ?? null,
        role: body.gitgone_role ?? null,
      },
    }
  }
}
