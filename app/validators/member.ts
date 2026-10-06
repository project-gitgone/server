import vine from '@vinejs/vine'

export const assignRoleValidator = vine.compile(vine.object({ roleId: vine.string() }))

export const projectMemberValidator = vine.compile(
  vine.object({ email: vine.string().email(), roleId: vine.string() })
)
