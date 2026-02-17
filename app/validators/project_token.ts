import vine from '@vinejs/vine'

export const createProjectTokenValidator = vine.compile(
  vine.object({
    name: vine.string().maxLength(255),
    environment: vine.string(),
    tokenSecretHash: vine.string(),
    encryptedProjectKey: vine.string(),
    expiresAt: vine.string().optional(),
  })
)
