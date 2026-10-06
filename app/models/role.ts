import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, computed } from '@adonisjs/lucid/orm'
import { nanoid } from 'nanoid'
import { DEFAULT_ROLES, type DefaultRoleKey } from '#services/rbac/default_roles'
import type { Grant, RoleScope } from '#services/rbac/permissions'

export default class Role extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare key: DefaultRoleKey | null

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column()
  declare scope: RoleScope

  @column()
  declare isSystem: boolean

  @column({
    serializeAs: null,
    prepare: (value: Grant[]) => JSON.stringify(value ?? []),
    consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value) as Grant[],
  })
  declare grants: Grant[]

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @computed({ serializeAs: 'grants' })
  get effectiveGrants(): Grant[] {
    return this.isSystem && this.key ? DEFAULT_ROLES[this.key].grants : this.grants
  }

  @beforeCreate()
  static assignId(role: Role) {
    role.id = role.id ?? `role_${nanoid(10)}`
  }
}
