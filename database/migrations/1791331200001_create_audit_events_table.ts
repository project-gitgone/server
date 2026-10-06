import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'audit_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.enum('actor_type', ['user', 'token']).notNullable()
      table.string('actor_id').notNullable()
      table.string('actor_label').notNullable()
      table.string('action').notNullable()
      table.string('project_id').nullable()
      table.string('environment').nullable()
      table.string('target_type').nullable()
      table.string('target_id').nullable()
      table.jsonb('details').nullable()
      table.string('ip').nullable()
      table.string('user_agent').nullable()
      table.timestamp('created_at').notNullable()
      table.index(['project_id', 'created_at'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
