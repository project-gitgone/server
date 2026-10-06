import vine from '@vinejs/vine'
import { environmentName } from '#validators/environment'

export const createProjectTokenValidator = vine.compile(
  vine.object({
    name: vine.string().maxLength(255),
    environment: environmentName(),
    authVerifier: vine.string().minLength(32).optional(),
    tokenSecretHash: vine.string().optional(),
    encryptedProjectKey: vine.string(),
    expiresAt: vine.string().optional(),
  })
)
