import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, belongsTo, column } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export const CLOUD_PROVIDER = 'gitgone-cloud'

export default class UserIdentity extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare userId: string

  @column()
  declare provider: string

  @column()
  declare subject: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @beforeCreate()
  static assignId(identity: UserIdentity) {
    identity.id = `uid_${nanoid(12)}`
  }
}
