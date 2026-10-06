import { createServer, type Server } from 'node:http'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import env from '#start/env'

const signingKey = generateKeyPairSync('ed25519')
const strayKey = generateKeyPairSync('ed25519')

export const CLOUD_ISSUER = 'https://cloud.test'
export const CLOUD_INSTANCE_ID = 'org_test'

let server: Server | null = null

export async function enableCloud() {
  if (!server) {
    const jwk = { ...signingKey.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'EdDSA' }
    server = createServer((_, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ keys: [jwk] }))
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  }
  const address = server.address() as { port: number }
  env.set('CLOUD_ISSUER', CLOUD_ISSUER)
  env.set('CLOUD_JWKS_URL', `http://127.0.0.1:${address.port}/jwks`)
  env.set('CLOUD_INSTANCE_ID', CLOUD_INSTANCE_ID)
  env.set('CLOUD_CLIENT_ID', 'client_test')
  env.set('CLOUD_CLIENT_SECRET', 'secret_test')
  env.set('APP_URL', 'https://instance.test')
}

export async function stopCloud() {
  if (!server) return
  await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = null
}

export function disableCloud() {
  env.set('CLOUD_ISSUER', '')
  env.set('CLOUD_JWKS_URL', '')
  env.set('CLOUD_INSTANCE_ID', '')
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url')

export function signCloudToken(
  claims: Record<string, unknown> = {},
  options: { key?: 'stray'; kid?: string; tamper?: boolean } = {}
) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: CLOUD_ISSUER,
    aud: CLOUD_INSTANCE_ID,
    iat: now,
    exp: now + 300,
    sub: 'cloud_user_1',
    token_use: 'instance-management',
    ...claims,
  }
  const header = { alg: 'EdDSA', typ: 'JWT', kid: options.kid ?? 'test-key' }
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const key: KeyObject = options.key === 'stray' ? strayKey.privateKey : signingKey.privateKey
  const signature = sign(null, Buffer.from(data), key)
  const token = `${data}.${base64url(signature)}`
  if (!options.tamper) return token
  const position = token.length - 20
  const flipped = token[position] === 'A' ? 'B' : 'A'
  return `${token.slice(0, position)}${flipped}${token.slice(position + 1)}`
}
