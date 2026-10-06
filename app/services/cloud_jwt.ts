import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto'
import { Exception } from '@adonisjs/core/exceptions'
import { cloudConfig } from '#services/cloud'

export class CloudTokenError extends Exception {
  static status = 401
}

export type CloudTokenPayload = {
  iss: string
  aud: string
  sub: string
  exp: number
  iat?: number
  nbf?: number
  scope?: string
  [claim: string]: unknown
}

export const TOKEN_USE = 'instance-management'
const MAX_LIFETIME_SECONDS = 600
const CLOCK_SKEW_SECONDS = 30
const JWKS_TTL_MS = 10 * 60 * 1000
const JWKS_REFRESH_MIN_MS = 30 * 1000

type KeySet = { url: string; keys: Map<string, KeyObject>; fetchedAt: number }
let keySet: KeySet | null = null
let lastAttempt = 0
let inFlight: Promise<void> | null = null

function importKeys(jwks: (JsonWebKey & { kid?: string; use?: string })[]) {
  const keys = new Map<string, KeyObject>()
  for (const jwk of jwks) {
    if (!jwk.kid || (jwk.use && jwk.use !== 'sig')) continue
    try {
      keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }))
    } catch {}
  }
  return keys
}

function refreshKeys(url: string) {
  inFlight ??= (async () => {
    lastAttempt = Date.now()
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) return
      const body = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] }
      keySet = { url, keys: importKeys(body.keys ?? []), fetchedAt: Date.now() }
    } catch {
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

async function signingKey(url: string, kid: string) {
  const current = keySet?.url === url ? keySet : null
  const stale = !current || Date.now() - current.fetchedAt > JWKS_TTL_MS
  const missing = !current?.keys.has(kid)
  if (!current || ((stale || missing) && Date.now() - lastAttempt > JWKS_REFRESH_MIN_MS)) {
    await refreshKeys(url)
  } else if (stale && inFlight) await inFlight
  const key = keySet?.url === url ? keySet.keys.get(kid) : undefined
  if (!key) throw new CloudTokenError('Unknown signing key')
  return key
}

const decode = <T>(part: string): T => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

function signatureValid(alg: string, data: Buffer, signature: Buffer, key: KeyObject) {
  if (alg === 'EdDSA') return verify(null, data, key, signature)
  if (alg === 'ES256') return verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature)
  if (alg === 'RS256') return verify('sha256', data, key, signature)
  return false
}

export async function verifyCloudToken(token: string): Promise<CloudTokenPayload> {
  const config = cloudConfig()
  if (!config) throw new CloudTokenError('This instance is not managed by GitGone Cloud')

  const parts = token.split('.')
  if (parts.length !== 3) throw new CloudTokenError('Malformed token')
  const [encodedHeader, encodedPayload, encodedSignature] = parts

  let header: { alg?: string; kid?: string }
  let payload: CloudTokenPayload
  try {
    header = decode(encodedHeader)
    payload = decode(encodedPayload)
  } catch {
    throw new CloudTokenError('Malformed token')
  }
  if (!header.alg || !header.kid) throw new CloudTokenError('Malformed token')

  const key = await signingKey(config.jwksUrl, header.kid)
  const valid = signatureValid(
    header.alg,
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    Buffer.from(encodedSignature, 'base64url'),
    key
  )
  if (!valid) throw new CloudTokenError('Invalid signature')

  const now = Math.floor(Date.now() / 1000)
  if (payload.token_use !== TOKEN_USE) throw new CloudTokenError('Not an instance management token')
  if (payload.iss !== config.issuer) throw new CloudTokenError('Invalid issuer')
  if (payload.aud !== config.instanceId) throw new CloudTokenError('Invalid audience')
  if (typeof payload.exp !== 'number' || payload.exp <= now - CLOCK_SKEW_SECONDS) {
    throw new CloudTokenError('Expired token')
  }
  if (typeof payload.iat !== 'number' || payload.exp - payload.iat > MAX_LIFETIME_SECONDS) {
    throw new CloudTokenError('Token lifetime too long')
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now + CLOCK_SKEW_SECONDS) {
    throw new CloudTokenError('Token not valid yet')
  }
  if (typeof payload.sub !== 'string' || !payload.sub) throw new CloudTokenError('Missing subject')
  return payload
}
