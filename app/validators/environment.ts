import vine from '@vinejs/vine'

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export const isEnvironmentName = (value: unknown): value is string =>
  typeof value === 'string' && NAME.test(value)

export const environmentName = () => vine.string().regex(NAME)

const retention = () => vine.number().withoutDecimals().min(1).max(10000).nullable().optional()

export const createEnvironmentValidator = vine.compile(
  vine.object({
    name: environmentName(),
    protected: vine.boolean().optional(),
    retention: retention(),
  })
)

export const updateEnvironmentValidator = vine.compile(
  vine.object({ protected: vine.boolean().optional(), retention: retention() })
)
