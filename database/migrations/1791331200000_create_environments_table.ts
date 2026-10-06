import { BaseSchema } from '@adonisjs/lucid/schema'
import { nanoid } from 'nanoid'
import { defaultProtection } from '#services/rbac/environments'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('environments', (table) => {
      table.string('id').primary()
      table.string('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE')
      table.string('name').notNullable()
      table.boolean('protected').notNullable().defaultTo(false)
      table.integer('retention').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.unique(['project_id', 'name'])
    })

    this.defer(async (db) => {
      const rows = await db.rawQuery(
        `SELECT DISTINCT project_id, environment AS name FROM secret_snapshots
         UNION SELECT DISTINCT project_id, environment AS name FROM project_tokens`
      )
      const now = new Date()
      const environments = rows.rows.map((r: { project_id: string; name: string }) => ({
        id: `env_${nanoid(10)}`,
        project_id: r.project_id,
        name: r.name,
        protected: defaultProtection(r.name),
        created_at: now,
      }))
      if (environments.length > 0) await db.table('environments').multiInsert(environments)
    })
  }

  async down() {
    this.schema.dropTable('environments')
  }
}
