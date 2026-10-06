import { BaseSchema } from '@adonisjs/lucid/schema'
import { nanoid } from 'nanoid'

export default class extends BaseSchema {
  async up() {
    this.schema.dropTable('team_members')
    this.schema.alterTable('users', (table) => {
      table.dropColumn('system_role')
    })
  }

  async down() {
    this.schema.alterTable('users', (table) => {
      table.enum('system_role', ['SUPERADMIN', 'USER']).defaultTo('USER')
    })
    this.schema.createTable('team_members', (table) => {
      table.string('id').primary()
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('team_id').notNullable().references('id').inTable('teams').onDelete('CASCADE')
      table.enum('role', ['OWNER', 'MEMBER']).defaultTo('MEMBER')
      table.unique(['user_id', 'team_id'])
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
    this.defer(async (db) => {
      await db.rawQuery(
        `UPDATE users SET system_role = 'SUPERADMIN' WHERE id IN (SELECT user_id FROM role_assignments WHERE scope_type = 'instance' AND role_id = 'role_owner')`
      )
      const rows = await db
        .from('role_assignments')
        .where('scope_type', 'team')
        .select('user_id', 'scope_id', 'role_id')
      if (rows.length > 0) {
        await db.table('team_members').multiInsert(
          rows.map((r) => ({
            id: `mem_${nanoid(10)}`,
            user_id: r.user_id,
            team_id: r.scope_id,
            role: r.role_id === 'role_maintainer' ? 'OWNER' : 'MEMBER',
            created_at: new Date(),
          }))
        )
      }
    })
  }
}
