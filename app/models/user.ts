import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, beforeSave, hasOne } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'
import type { HasOne } from '@adonisjs/lucid/types/relations'
import RoleAssignment from '#models/role_assignment'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import hash from '@adonisjs/core/services/hash'
import env from '#start/env'
import crypto from 'node:crypto'

export type KdfParams = {
  algo: 'scrypt'
  salt: string
  N: number
  r: number
  p: number
}

export const V2_KEY_ENCRYPTION_ALGO = 'scrypt-hkdf-aes-256-gcm'

const ACTIVATION_CODE_TTL_HOURS = 72

export default class User extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare fullName: string

  @column()
  declare email: string

  @column({ serializeAs: null })
  declare password: string | null

  @column()
  declare publicKey: string | null

  @column({ serializeAs: null })
  declare encryptedPrivateKey: string | null

  @column({ serializeAs: null })
  declare keySalt: string | null

  @column({ serializeAs: null })
  declare keyEncryptionAlgo: string | null

  @column()
  declare cryptoVersion: number

  @column({
    serializeAs: null,
    prepare: (value: KdfParams | null) => (value ? JSON.stringify(value) : null),
  })
  declare kdfParams: KdfParams | null

  @column({ serializeAs: null })
  declare activationCode: string | null

  @column.dateTime({ serializeAs: null })
  declare activationExpiresAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column()
  declare deactivatedBy: 'instance' | 'cloud' | null

  @hasOne(() => RoleAssignment, {
    foreignKey: 'userId',
    onQuery: (query) => query.where('scope_type', 'instance'),
  })
  declare instanceRole: HasOne<typeof RoleAssignment>

  static accessTokens = DbAccessTokensProvider.forModel(User, {
    expiresIn: env.get('TOKEN_EXPIRES_IN', '30 days'),
  })

  @beforeCreate()
  static assignId(user: User) {
    user.id = `user_${nanoid(10)}`
    user.cryptoVersion ??= 1
  }

  @beforeSave()
  static async hashPassword(user: User) {
    if (user.$dirty.password && user.password) {
      user.password = await hash.make(user.password)
    }
  }

  static findActiveByEmail(email: string) {
    return User.query().where('email', email).whereNull('deleted_at').first()
  }

  static async verifyCredentials(
    email: string,
    credentials: { password?: string; authKey?: string }
  ) {
    const user = await User.findActiveByEmail(email)
    if (!user || !user.password) {
      return null
    }

    const secret = user.cryptoVersion === 2 ? credentials.authKey : credentials.password
    if (!secret || !(await hash.verify(user.password, secret))) {
      return null
    }

    return user
  }

  static async revokeAccessTokens(user: User, exceptIdentifier?: string | number | BigInt) {
    const tokens = await User.accessTokens.all(user)
    for (const token of tokens) {
      if (exceptIdentifier === undefined || String(token.identifier) !== String(exceptIdentifier)) {
        await User.accessTokens.delete(user, token.identifier)
      }
    }
  }

  async issueActivationCode() {
    const code = crypto.randomBytes(18).toString('base64url')
    this.activationCode = await hash.make(code)
    this.activationExpiresAt = DateTime.now().plus({ hours: ACTIVATION_CODE_TTL_HOURS })
    return code
  }

  toAuthJSON() {
    return {
      id: this.id,
      email: this.email,
      full_name: this.fullName,
      publicKey: this.publicKey,
      encryptedPrivateKey: this.encryptedPrivateKey,
      keySalt: this.keySalt,
      keyEncryptionAlgo: this.keyEncryptionAlgo,
      cryptoVersion: this.cryptoVersion,
      kdfParams: this.kdfParams,
    }
  }
}
