import vine from '@vinejs/vine'
import { environmentName } from '#validators/environment'

export const pushSecretValidator = vine.compile(
  vine.object({
    projectId: vine.string(),
    environment: environmentName(),
    rollbackOf: vine.string().optional(),
    keyScope: vine.enum(['project', 'environment']).optional(),
    cryptoVersion: vine.literal(2).optional(),
    version: vine
      .number()
      .withoutDecimals()
      .positive()
      .optional()
      .requiredIfExists('cryptoVersion'),
    keyVersion: vine
      .number()
      .withoutDecimals()
      .positive()
      .optional()
      .requiredIfExists('cryptoVersion'),
    encryptedData: vine.object({
      ciphertext: vine.string(),
      iv: vine.string(),
      authTag: vine.string(),
    }),
  })
)
