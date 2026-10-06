import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Team from '#models/team'
import SecretSnapshot from '#models/secret_snapshot'
import RoleAssignment from '#models/role_assignment'

export default class Project extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare name: string

  @column()
  declare teamId: string

  @column()
  declare disallowPull: boolean

  @column()
  declare keyVersion: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Team)
  declare team: BelongsTo<typeof Team>

  @hasMany(() => SecretSnapshot)
  declare snapshots: HasMany<typeof SecretSnapshot>

  @hasMany(() => RoleAssignment, {
    foreignKey: 'scopeId',
    onQuery: (query) => query.where('scope_type', 'project'),
  })
  declare members: HasMany<typeof RoleAssignment>

  @beforeCreate()
  static assignId(project: Project) {
    project.id = `proj_${nanoid(10)}`
    project.keyVersion ??= 1
  }
}
