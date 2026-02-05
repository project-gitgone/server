import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Team from '#models/team'
import SecretSnapshot from '#models/secret_snapshot'

export default class Project extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare name: string

  @column()
  declare teamId: string

  @column()
  declare disallowPull: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Team)
  declare team: BelongsTo<typeof Team>

  @hasMany(() => SecretSnapshot)
  declare snapshots: HasMany<typeof SecretSnapshot>

  @beforeCreate()
  static assignId(project: Project) {
    project.id = `proj_${nanoid(10)}`
  }
}
