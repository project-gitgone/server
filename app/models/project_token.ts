import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, belongsTo } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from '#models/project'
import User from '#models/user'

export default class ProjectToken extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare name: string

  @column()
  declare token: string

  @column()
  declare projectId: string

  @column()
  declare environment: string

  @column()
  declare encryptedProjectKey: string

  @column()
  declare createdBy: string | null

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Project)
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @beforeCreate()
  static assignId(token: ProjectToken) {
    token.id = `ptok_${nanoid(10)}`
  }
}
