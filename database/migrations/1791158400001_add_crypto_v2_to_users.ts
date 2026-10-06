import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('crypto_version').notNullable().defaultTo(1)
      table.jsonb('kdf_params').nullable()
      table.string('activation_code').nullable()
      table.timestamp('activation_expires_at').nullable()
      table.string('password').nullable().alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('crypto_version')
      table.dropColumn('kdf_params')
      table.dropColumn('activation_code')
      table.dropColumn('activation_expires_at')
      table.string('password').notNullable().alter()
    })
  }
}
