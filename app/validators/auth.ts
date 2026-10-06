import vine from '@vinejs/vine'

export const kdfParamsSchema = vine.object({
  algo: vine.enum(['scrypt']),
  salt: vine.string().minLength(22),
  N: vine.number().withoutDecimals().range([2 ** 17, 2 ** 20]),
  r: vine.number().withoutDecimals().range([8, 16]),
  p: vine.number().withoutDecimals().range([1, 4]),
})

const authKey = () => vine.string().minLength(43).maxLength(128)

export const preloginValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
  })
)

export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    password: vine.string().optional(),
    authKey: vine.string().optional(),
  })
)

export const upgradeAccountValidator = vine.compile(
  vine.object({
    password: vine.string(),
    authKey: authKey(),
    kdf: kdfParamsSchema,
    encryptedPrivateKey: vine.string(),
  })
)

export const changePasswordValidator = vine.compile(
  vine.object({
    currentAuthKey: vine.string(),
    authKey: authKey(),
    kdf: kdfParamsSchema,
    encryptedPrivateKey: vine.string(),
  })
)

export const activateAccountValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    code: vine.string(),
    authKey: authKey(),
    kdf: kdfParamsSchema,
    publicKey: vine.string(),
    encryptedPrivateKey: vine.string(),
  })
)

export const cloudLoginValidator = vine.compile(
  vine.object({
    port: vine.number().withoutDecimals().range([1024, 65535]),
    state: vine.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
    code_challenge: vine.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
)

export const cloudExchangeValidator = vine.compile(
  vine.object({
    code: vine.string().maxLength(128),
    codeVerifier: vine.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  })
)
