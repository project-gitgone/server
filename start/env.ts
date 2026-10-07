import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  APP_URL: Env.schema.string.optional(),
  STATUS_PAGE: Env.schema.boolean.optional(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),

  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  DB_POOL_MIN: Env.schema.number.optional(),
  DB_POOL_MAX: Env.schema.number.optional(),

  ALLOW_REGISTRATION: Env.schema.boolean.optional(),
  CORS_ALLOWED_ORIGINS: Env.schema.string.optional(),
  TRUST_PROXY: Env.schema.boolean.optional(),

  TOKEN_EXPIRES_IN: Env.schema.string.optional(),
  ALLOW_LEGACY_TOKENS: Env.schema.boolean.optional(),
  ALLOW_LEGACY_CLIENTS: Env.schema.boolean.optional(),
  AUDIT_RETENTION_DAYS: Env.schema.number.optional(),
  CLOUD_ISSUER: Env.schema.string.optional(),
  CLOUD_JWKS_URL: Env.schema.string.optional(),
  CLOUD_INSTANCE_ID: Env.schema.string.optional(),
  CLOUD_CLIENT_ID: Env.schema.string.optional(),
  CLOUD_CLIENT_SECRET: Env.schema.string.optional(),
})
