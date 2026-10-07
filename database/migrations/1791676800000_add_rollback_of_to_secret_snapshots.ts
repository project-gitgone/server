import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'secret_snapshots'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('rollback_of').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('rollback_of')
    })
  }
}
