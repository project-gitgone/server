import vine from '@vinejs/vine'

export const timelineValidator = vine.compile(
  vine.object({
    limit: vine.number().withoutDecimals().range([1, 100]).optional(),
    before: vine.date({ formats: { utc: true } }).optional(),
  })
)
