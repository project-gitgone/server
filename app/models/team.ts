import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, hasMany } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Project from '#models/project'
import RoleAssignment from '#models/role_assignment'

export default class Team extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare name: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => RoleAssignment, {
    foreignKey: 'scopeId',
    onQuery: (query) => query.where('scope_type', 'team'),
  })
  declare members: HasMany<typeof RoleAssignment>

  @hasMany(() => Project)
  declare projects: HasMany<typeof Project>

  @beforeCreate()
  static assignId(team: Team) {
    team.id = `team_${nanoid(10)}`
  }
}
