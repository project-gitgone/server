import env from '#start/env'

export type CloudConfig = { issuer: string; jwksUrl: string; instanceId: string }

export function cloudConfig(): CloudConfig | null {
  const issuer = env.get('CLOUD_ISSUER')
  const jwksUrl = env.get('CLOUD_JWKS_URL')
  const instanceId = env.get('CLOUD_INSTANCE_ID')
  if (!issuer || !jwksUrl || !instanceId) return null
  return { issuer, jwksUrl, instanceId }
}

export function cloudLoginConfig() {
  const config = cloudConfig()
  const clientId = env.get('CLOUD_CLIENT_ID')
  const clientSecret = env.get('CLOUD_CLIENT_SECRET')
  const appUrl = env.get('APP_URL')
  if (!config || !clientId || !clientSecret || !appUrl) return null
  return {
    issuer: config.issuer,
    clientId,
    clientSecret,
    callbackUrl: `${appUrl.replace(/\/+$/, '')}/auth/cloud/callback`,
  }
}
