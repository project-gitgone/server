import vine from '@vinejs/vine'

export const pushSecretValidator = vine.compile(
  vine.object({
    projectId: vine.string(),
    environment: vine.string(),
    encryptedData: vine.object({
      ciphertext: vine.string(),
      iv: vine.string(),
      authTag: vine.string(),
    }),
  })
)
