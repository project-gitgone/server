// import db from '@adonisjs/lucid/services/db'
// import logger from '@adonisjs/core/services/logger'
// import app from '@adonisjs/core/services/app'
// import { MigrationRunner } from '@adonisjs/lucid/migration'
// import env from './env.js'


// try {

//   if (db.manager.connections) {
//     logger.info('Database connection: OK')

//     const migrator = new MigrationRunner(db, app, {
//         direction: 'up',
//         dryRun: true,
//     })

//     const migrations = await migrator.getList()
//     const pending = migrations.filter((m) => m.status === 'pending')

//     if (pending.length > 0) {
//         logger.warn(`There are ${pending.length} pending migrations."`)

//         pending.forEach((migration) => {
//             logger.warn(`- ${migration.name}`);
//         });

//         if(env.get('NODE_ENV') === 'production' && !env.get('DB_ALLOW_MIGRATIONS_IN_PRODUCTION', false)) {
//             logger.error('Pending migrations detected in production environment. Please run migrations before starting the server.')
//             process.exit(1)
//         } else if (env.get('NODE_ENV') === 'production' && env.get('DB_ALLOW_MIGRATIONS_IN_PRODUCTION', true)) {
//             logger.info('DB_ALLOW_MIGRATIONS_IN_PRODUCTION is set to true. Running migrations in production environment.')
//             await migrator.run()
//             logger.info('Migrations completed successfully.')
//         }
//     } else {
//         logger.info('Migrations: Up to date')
//     }

//   } else {
//     logger.error('Database connection: FAILED')
//     logger.error('No connection to the database')
//     process.exit(1)
//   }
// } catch (error) {
//   logger.error('Failed to connect to the database')
//   logger.error(error.message)
//   process.exit(1)
// }
