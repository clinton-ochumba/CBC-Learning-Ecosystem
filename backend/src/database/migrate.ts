/**
 * Migration runner — CBC Learning Ecosystem
 * Called by the Dockerfile CMD before starting the server.
 * Uses Knex migrate:latest so it's idempotent on every deploy.
 *
 * Usage: node -e "require('./dist/database/migrate').run()"
 */

import Knex from 'knex';
import path from 'path';

export async function run(): Promise<void> {
  const db = Knex({
    client: 'postgresql',
    connection: process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
      : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME     || 'cbc_learning_ecosystem',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      },
  });

  try {
    console.log('[migration] Running pending migrations…');
    const [batch, migrations] = await db.migrate.latest({
      directory: path.join(__dirname, 'migrations'),
    });

    if (migrations.length === 0) {
      console.log('[migration] ✅ No pending migrations');
    } else {
      console.log(`[migration] ✅ Batch ${batch} run: ${migrations.length} migrations complete`);
      migrations.forEach((m: string) => console.log(`  → ${path.basename(m)}`));
    }
  } catch (err) {
    console.error('[migration] ❌ Migration failed:', (err as Error).message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

// Allow direct execution: node dist/database/migrate.js
if (require.main === module) {
  run();
}
