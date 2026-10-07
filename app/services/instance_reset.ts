import db from '@adonisjs/lucid/services/db'
import Role from '#models/role'

const KEPT_TABLES = new Set(['adonis_schema', 'adonis_schema_versions', 'roles'])

export async function wipeInstance() {
  const rows = await db.from('pg_tables').where('schemaname', 'public').select('tablename')
  const tables = rows.map((row) => row.tablename as string).filter((name) => !KEPT_TABLES.has(name))

  await db.transaction(async (trx) => {
    if (tables.length > 0) {
      await trx.rawQuery(
        `TRUNCATE ${tables.map((name) => `"${name}"`).join(', ')} RESTART IDENTITY CASCADE`
      )
    }
    await Role.query({ client: trx }).where('is_system', false).delete()
  })
  return { tables: tables.length }
}

export async function resetAccess() {
  return db.transaction(async (trx) => {
    const sessions = await trx.from('auth_access_tokens').delete()
    const tokens = await trx.from('project_tokens').delete()
    await trx.from('login_codes').delete()
    const environments = await trx.from('environments').update({ rotation_required: true })
    return {
      sessions: Number(sessions ?? 0),
      tokens: Number(tokens ?? 0),
      environments: Number(environments ?? 0),
    }
  })
}
