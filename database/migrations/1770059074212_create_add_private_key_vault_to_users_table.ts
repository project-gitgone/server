import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('encrypted_private_key').nullable()

      table.string('key_salt').nullable()

      table.string('key_encryption_algo').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('encrypted_private_key')
      table.dropColumn('key_salt')
      table.dropColumn('key_encryption_algo')
    })
  }
}
