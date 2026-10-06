import { BaseSchema } from '@adonisjs/lucid/schema'
import { DEFAULT_ROLES, defaultRoleId } from '#services/rbac/default_roles'
import { legacyAssignmentRows } from '#services/rbac/legacy'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('roles', (table) => {
      table.string('id').primary()
      table.string('key').nullable().unique()
      table.string('name').notNullable()
      table.text('description').nullable()
      table.enum('scope', ['instance', 'workspace']).notNullable()
      table.boolean('is_system').notNullable().defaultTo(false)
      table.jsonb('grants').notNullable().defaultTo('[]')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('role_assignments', (table) => {
      table.string('id').primary()
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('role_id').notNullable().references('id').inTable('roles').onDelete('RESTRICT')
      table.enum('scope_type', ['instance', 'team', 'project']).notNullable()
      table.string('scope_id').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.unique(['user_id', 'scope_type', 'scope_id'])
      table.index(['scope_type', 'scope_id'])
    })

    this.schema.raw(
      `CREATE UNIQUE INDEX role_assignments_one_instance_role ON role_assignments (user_id) WHERE scope_type = 'instance'`
    )
    this.schema.raw(
      `ALTER TABLE role_assignments ADD CONSTRAINT role_assignments_scope_id_check CHECK ((scope_type = 'instance') = (scope_id IS NULL))`
    )

    this.defer(async (db) => {
      const now = new Date()
      await db.table('roles').multiInsert(
        Object.values(DEFAULT_ROLES).map((role) => ({
          id: defaultRoleId(role.key),
          key: role.key,
          name: role.name,
          description: role.description,
          scope: role.scope,
          is_system: true,
          grants: JSON.stringify([]),
          created_at: now,
        }))
      )

      const users = await db.from('users').select('id', 'system_role')
      const members = await db.from('team_members').select('user_id', 'team_id', 'role')
      const rows = legacyAssignmentRows(users, members, now)
      if (rows.length > 0) await db.table('role_assignments').multiInsert(rows)
    })
  }

  async down() {
    this.schema.dropTable('role_assignments')
    this.schema.dropTable('roles')
  }
}
