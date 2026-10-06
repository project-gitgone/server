import vine from '@vinejs/vine'

export const createUserValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    fullName: vine.string().minLength(2),
    roleId: vine.string().optional(),
    systemRole: vine.enum(['SUPERADMIN', 'USER']).optional(),
  })
)

export const updateUserValidator = vine.compile(
  vine.object({
    email: vine.string().email().optional(),
    fullName: vine.string().minLength(2).optional(),
  })
)
