import vine from '@vinejs/vine'
import { kdfParamsSchema } from '#validators/auth'

export const uploadPublicKeyValidator = vine.compile(
  vine.object({
    publicKey: vine.string(),
    encryptedPrivateKey: vine.string().optional(),
    keySalt: vine.string().optional(),
    keyEncryptionAlgo: vine.string().optional(),
    kdf: kdfParamsSchema.optional(),
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
    keyVersion: vine.number().withoutDecimals().positive().optional(),
  })
)

export const rotateProjectKeyValidator = vine.compile(
  vine.object({
    expectedKeyVersion: vine.number().withoutDecimals().min(0),
    keys: vine.array(
      vine.object({
        userId: vine.string(),
        encryptedKey: vine.string(),
      })
    ),
    snapshots: vine.array(
      vine.object({
        id: vine.string(),
        ciphertext: vine.string(),
        iv: vine.string(),
        authTag: vine.string(),
      })
    ),
  })
)
