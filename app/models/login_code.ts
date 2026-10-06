import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'

export default class LoginCode extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare codeHash: string

  @column()
  declare userId: string

  @column()
  declare codeChallenge: string

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @beforeCreate()
  static assignId(code: LoginCode) {
    code.id = `lgc_${nanoid(12)}`
  }
}
