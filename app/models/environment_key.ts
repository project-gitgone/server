import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'

export default class EnvironmentKey extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare environmentId: string

  @column()
  declare userId: string

  @column()
  declare encryptedKey: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @beforeCreate()
  static assignId(key: EnvironmentKey) {
    key.id = `ek_${nanoid(12)}`
  }
}
