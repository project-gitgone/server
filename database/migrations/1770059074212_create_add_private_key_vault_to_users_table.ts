import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Stocke la clé privée chiffrée par la passphrase de l'utilisateur
      table.text('encrypted_private_key').nullable()
      
      // Stocke le sel utilisé pour dériver la clé de chiffrement (pour que le client puisse reconstruire la clé)
      table.string('key_salt').nullable()
      
      // Stocke l'algo utilisé (ex: 'aes-256-gcm') pour pérennité
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
