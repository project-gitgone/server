import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, belongsTo } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Team from '#models/team'

export default class TeamMember extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare userId: string

  @column()
  declare teamId: string

  @column()
  declare role: 'OWNER' | 'MEMBER'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Team)
  declare team: BelongsTo<typeof Team>

  @beforeCreate()
  static assignId(member: TeamMember) {
    member.id = `mem_${nanoid(10)}`
  }
}
