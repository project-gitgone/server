import { readdirSync } from 'node:fs'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'

const MIGRATION_FILE = /^(?!.*\.d\.ts$).+\.(ts|js)$/

async function databaseLatency() {
  const started = performance.now()
  try {
    await db.rawQuery('select 1')
    return Math.round(performance.now() - started)
  } catch {
    return null
  }
}

async function pendingMigrations() {
  const rows = await db.from('adonis_schema').select('name')
  const applied = new Set(rows.map((row) => row.name))
  return readdirSync(app.migrationsPath())
    .filter((file) => MIGRATION_FILE.test(file))
    .map((file) => `database/migrations/${file.replace(/\.(ts|js)$/, '')}`)
    .filter((name) => !applied.has(name)).length
}

export async function instanceHealth() {
  const latency = await databaseLatency()
  return {
    databaseLatency: latency,
    pendingMigrations: latency === null ? null : await pendingMigrations(),
  }
}
