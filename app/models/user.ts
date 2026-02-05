import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, beforeSave, hasMany, manyToMany } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'
import type { HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import TeamMember from '#models/team_member'
import Team from '#models/team'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import hash from '@adonisjs/core/services/hash'

export default class User extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare fullName: string

  @column()
  declare email: string

  @column({ serializeAs: null })
  declare password: string

  @column()
  declare systemRole: 'SUPERADMIN' | 'USER'

  @column()
  declare publicKey: string | null

  @column()
  declare encryptedPrivateKey: string | null

  @column()
  declare keySalt: string | null

  @column()
  declare keyEncryptionAlgo: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @hasMany(() => TeamMember)
  declare memberships: HasMany<typeof TeamMember>

  @manyToMany(() => Team, {
    pivotTable: 'team_members',
    pivotColumns: ['role'],
  })
  declare teams: ManyToMany<typeof Team>

  static accessTokens = DbAccessTokensProvider.forModel(User)

  @beforeCreate()
  static assignId(user: User) {
    user.id = `user_${nanoid(10)}`
  }

  @beforeSave()
  static async hashPassword(user: User) {
    if (user.$dirty.password) {
      user.password = await hash.make(user.password)
    }
  }

  static async verifyCredentials(email: string, password: string) {
    const user = await User.findBy('email', email)
    if (!user) {
      return null
    }

    const isValid = await hash.verify(user.password, password)
    if (!isValid) {
      return null
    }

    return user
  }
}
