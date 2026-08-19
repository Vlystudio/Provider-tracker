import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for database commands. Copy .env.example to .env and set it.');
  }
  return databaseUrl;
}

export function createDatabase(databaseUrl = getDatabaseUrl()) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'ura-provider-availability',
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}

export type Database = ReturnType<typeof createDatabase>['db'];
