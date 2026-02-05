import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'secret_snapshots'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.string('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE')
      table.string('environment').notNullable() // 'development', 'staging', 'production'
      table.integer('version').notNullable()
      
      table.text('ciphertext').notNullable()
      table.string('iv').notNullable()
      table.string('auth_tag').notNullable()

      table.string('created_by').notNullable().references('id').inTable('users').onDelete('CASCADE')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // Unique constraint for version per project+environment
      table.unique(['project_id', 'environment', 'version'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
