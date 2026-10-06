import vine from '@vinejs/vine'
import { kdfParamsSchema } from '#validators/auth'

export const initAdminValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    fullName: vine.string().minLength(2),
    authKey: vine.string().minLength(43).maxLength(128),
    kdf: kdfParamsSchema,
    publicKey: vine.string(),
    encryptedPrivateKey: vine.string(),
  })
)
