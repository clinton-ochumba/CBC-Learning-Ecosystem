/**
 * Database connection — CBC Learning Ecosystem
 *
 * Prefers DATABASE_URL (single connection string from Neon / Railway).
 * Falls back to discrete DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD env vars.
 * Always uses SSL in production.
 */

import knex, { Knex } from 'knex';
import { logger } from '../utils/logger';

const isProd = process.env.NODE_ENV === 'production';

const connection = process.env.DATABASE_URL
  ? {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },   // Neon & Railway use self-signed certs
  }
  : {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME     || 'cbc_learning_ecosystem',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };

export const db: Knex = knex({
  client: 'postgresql',
  connection,
  pool: {
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    // Neon serverless auto-pauses — reconnect on wake
    acquireTimeoutMillis: 30_000,
    idleTimeoutMillis:    30_000,
  },
  // Surface slow queries in logs
  asyncStackTraces: !isProd,
});

// Verify connectivity at startup
export async function checkDatabaseConnection(): Promise<void> {
  try {
    await db.raw('SELECT 1');
    logger.info('[db] ✅ Database connected');
  } catch (err) {
    logger.error('[db] ❌ Database connection failed', { error: (err as Error).message });
    throw err;
  }
}
