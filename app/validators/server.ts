import vine from '@vinejs/vine'

export const initAdminValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    password: vine.string().minLength(8),
    fullName: vine.string().minLength(2),
    publicKey: vine.string(),
    encryptedPrivateKey: vine.string(),
    keySalt: vine.string(),
    keyEncryptionAlgo: vine.string(),
  })
)
