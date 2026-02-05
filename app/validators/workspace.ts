import vine from '@vinejs/vine'

export const createTeamValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(3),
  })
)

export const addMemberValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    role: vine.enum(['OWNER', 'MEMBER']).optional(),
  })
)

export const createProjectValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(2),
  })
)

export const updateProjectValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(2).optional(),
    disallowPull: vine.boolean().optional(),
  })
)
