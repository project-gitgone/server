import vine from '@vinejs/vine'

export const createUserValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    password: vine.string().minLength(8),
    fullName: vine.string().minLength(2),
    systemRole: vine.enum(['SUPERADMIN', 'USER']).optional(),
    publicKey: vine.string(),
    encryptedPrivateKey: vine.string(),
    keySalt: vine.string(),
    keyEncryptionAlgo: vine.string(),
  })
)

export const updateUserValidator = vine.compile(
  vine.object({
    email: vine.string().email().optional(),
    fullName: vine.string().minLength(2).optional(),
    systemRole: vine.enum(['SUPERADMIN', 'USER']).optional(),
    password: vine.string().minLength(8).optional(),
  })
)
