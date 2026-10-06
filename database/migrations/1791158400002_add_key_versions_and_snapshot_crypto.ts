import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('projects', (table) => {
      table.integer('key_version').notNullable().defaultTo(1)
    })
    this.schema.alterTable('secret_snapshots', (table) => {
      table.integer('crypto_version').notNullable().defaultTo(1)
      table.integer('key_version').notNullable().defaultTo(1)
    })
  }

  async down() {
    this.schema.alterTable('secret_snapshots', (table) => {
      table.dropColumn('crypto_version')
      table.dropColumn('key_version')
    })
    this.schema.alterTable('projects', (table) => {
      table.dropColumn('key_version')
    })
  }
}
