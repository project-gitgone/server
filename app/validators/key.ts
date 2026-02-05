import vine from '@vinejs/vine'

export const uploadPublicKeyValidator = vine.compile(
  vine.object({
    publicKey: vine.string(),
    encryptedPrivateKey: vine.string().optional(),
    keySalt: vine.string().optional(),
    keyEncryptionAlgo: vine.string().optional(),
  })
)

export const setupProjectKeyValidator = vine.compile(
  vine.object({
    encryptedKey: vine.string(),
  })
)

export const shareProjectKeyValidator = vine.compile(
  vine.object({
    targetUserId: vine.string(),
    encryptedKey: vine.string(),
  })
)
