import vine from '@vinejs/vine'

export const createRoleValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(60),
    description: vine.string().trim().maxLength(255).optional(),
    scope: vine.enum(['instance', 'workspace']),
    grants: vine.array(vine.any()),
  })
)

export const updateRoleValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(60).optional(),
    description: vine.string().trim().maxLength(255).optional(),
    grants: vine.array(vine.any()).optional(),
  })
)
