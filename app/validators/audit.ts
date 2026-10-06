import vine from '@vinejs/vine'

export const auditQueryValidator = vine.compile(
  vine.object({
    projectId: vine.string().optional(),
    action: vine.string().optional(),
    actorId: vine.string().optional(),
    from: vine.date({ formats: ['iso8601'] }).optional(),
    to: vine.date({ formats: ['iso8601'] }).optional(),
    page: vine.number().withoutDecimals().min(1).optional(),
    limit: vine.number().withoutDecimals().min(1).max(100).optional(),
  })
)
