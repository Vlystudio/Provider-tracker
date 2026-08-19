import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { getServerConfig, requireDatabaseUrl } from './config';

let sharedPool: Pool | null = null;

export function getDatabasePool(): Pool | null {
  const config = getServerConfig();
  const url = config.DATABASE_URL;
  if (!url) return null;

  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString: url,
      max: config.DATABASE_POOL_SIZE,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'ura-provider-availability',
    });
  }

  return sharedPool;
}

export function getDatabaseClient() {
  const pool = getDatabasePool();
  if (!pool) return null;
  return drizzle(pool, { schema });
}

export function requireDatabaseClient() {
  const db = getDatabaseClient();
  if (!db) {
    throw new Error('Database configuration is required for this operation.');
  }
  return db;
}

export async function getDatabaseHealth() {
  const pool = getDatabasePool();
  if (!pool) {
    return { ok: false, message: 'Ask IT to check the database connection for this environment.' };
  }

  try {
    await pool.query('SELECT 1 as ok');
    return { ok: true, message: 'Database is reachable.' };
  } catch (error) {
    console.error('Database health check failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      code: typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined,
    });
    return {
      ok: false,
      message: 'The database could not be reached. Try again or ask IT to check the service.',
    };
  }
}

export async function withDatabase<T>(handler: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const pool = getDatabasePool();
  if (!pool) {
    throw new Error('DATABASE_URL is not configured.');
  }

  const db = drizzle(pool, { schema });
  try {
    return await handler(db);
  } finally {
    // The shared pool is intentionally reused across requests; no per-query teardown here.
  }
}

export async function getDatabasePing() {
  const db = getDatabaseClient();
  if (!db) {
    return { ok: false, message: 'Database configuration is missing.' };
  }

  try {
    const result = await db.execute(sql`SELECT 1 AS ok`);
    return { ok: true, result };
  } catch (error) {
    console.error('Database ping failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      code: typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined,
    });
    return {
      ok: false,
      message: 'Database is not reachable right now.',
    };
  }
}

export function getDatabaseUrl() {
  return requireDatabaseUrl();
}
