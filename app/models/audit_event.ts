import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'

export default class AuditEvent extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare actorType: 'user' | 'token'

  @column()
  declare actorId: string

  @column()
  declare actorLabel: string

  @column()
  declare action: string

  @column()
  declare projectId: string | null

  @column()
  declare environment: string | null

  @column()
  declare targetType: string | null

  @column()
  declare targetId: string | null

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare details: Record<string, unknown> | null

  @column()
  declare ip: string | null

  @column()
  declare userAgent: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @beforeCreate()
  static assignId(event: AuditEvent) {
    event.id = `aud_${nanoid(14)}`
  }
}
