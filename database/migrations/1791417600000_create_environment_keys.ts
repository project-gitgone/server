import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('environments', (table) => {
      table.integer('key_version').nullable()
      table.boolean('rotation_required').notNullable().defaultTo(false)
    })

    this.schema.createTable('environment_keys', (table) => {
      table.string('id').primary()
      table
        .string('environment_id')
        .notNullable()
        .references('id')
        .inTable('environments')
        .onDelete('CASCADE')
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.text('encrypted_key').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.unique(['environment_id', 'user_id'])
    })
  }

  async down() {
    this.schema.dropTable('environment_keys')
    this.schema.alterTable('environments', (table) => {
      table.dropColumn('key_version')
      table.dropColumn('rotation_required')
    })
  }
}
