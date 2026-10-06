import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_tokens'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('crypto_version').notNullable().defaultTo(1)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('crypto_version')
    })
  }
}
