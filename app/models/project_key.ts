import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from '#models/project'
import User from '#models/user'

export default class ProjectKey extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare projectId: string

  @column()
  declare userId: string

  @column()
  declare encryptedKey: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Project)
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
