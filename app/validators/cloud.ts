import vine from '@vinejs/vine'

export const cloudIdentityValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    name: vine.string().maxLength(255).nullable().optional(),
    emailVerified: vine.boolean(),
    role: vine.string().maxLength(60),
  })
)
