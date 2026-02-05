import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, hasMany, manyToMany } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'
import type { HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import TeamMember from '#models/team_member'
import Project from '#models/project'
import User from '#models/user'

export default class Team extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare name: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => TeamMember)
  declare members: HasMany<typeof TeamMember>

  @manyToMany(() => User, {
    pivotTable: 'team_members',
    pivotColumns: ['role'],
  })
  declare users: ManyToMany<typeof User>

  @hasMany(() => Project)
  declare projects: HasMany<typeof Project>

  @beforeCreate()
  static assignId(team: Team) {
    team.id = `team_${nanoid(10)}`
  }
}
