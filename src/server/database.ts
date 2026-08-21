import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { getServerConfig, requireDatabaseUrl } from './config';
import { logEvent, safeErrorFields } from './logger';
import { incrementMetric, observeDuration } from './metrics';

let sharedPool: Pool | null = null;

export function getDatabasePool(): Pool | null {
  const config = getServerConfig();
  const url = config.DATABASE_URL;
  if (!url) return null;

  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString: url,
      max: config.DATABASE_POOL_SIZE,
      idleTimeoutMillis: config.DATABASE_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS,
      statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
      query_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS + 1_000,
      application_name: 'provider-tracker',
    });
    sharedPool.on('error', (error) => {
      incrementMetric('provider_tracker_database_failures_total', { operation: 'pool' });
      logEvent('error', 'database.pool-error', safeErrorFields(error));
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
    const started = performance.now();
    await pool.query('SELECT 1 as ok');
    observeDuration('provider_tracker_database_query_duration_ms', performance.now() - started, { operation: 'health' });
    return { ok: true, message: 'Database is reachable.' };
  } catch (error) {
    incrementMetric('provider_tracker_database_failures_total', { operation: 'health' });
    logEvent('warn', 'database.health-failed', safeErrorFields(error));
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
    incrementMetric('provider_tracker_database_failures_total', { operation: 'ping' });
    logEvent('warn', 'database.ping-failed', safeErrorFields(error));
    return {
      ok: false,
      message: 'Database is not reachable right now.',
    };
  }
}

export function getDatabaseUrl() {
  return requireDatabaseUrl();
}

export type DatabaseReadiness = {
  ok: boolean;
  checks: {
    connection: boolean;
    schema: boolean;
    postgis: boolean;
    spatialIndex: boolean;
  };
};

export async function getDatabaseReadiness(): Promise<DatabaseReadiness> {
  const config = getServerConfig();
  if (config.APP_DATA_MODE === 'demo') {
    return { ok: true, checks: { connection: true, schema: true, postgis: true, spatialIndex: true } };
  }
  const pool = getDatabasePool();
  const failed = { ok: false, checks: { connection: false, schema: false, postgis: false, spatialIndex: false } };
  if (!pool) return failed;

  try {
    const started = performance.now();
    const result = await pool.query<{
      schema_ready: boolean;
      postgis_ready: boolean;
      spatial_index_ready: boolean;
    }>(`
      SELECT
        to_regclass('public.users') IS NOT NULL
          AND to_regclass('public.sessions') IS NOT NULL
          AND to_regclass('public.facilities') IS NOT NULL
          AND to_regclass('public.facility_verification_events') IS NOT NULL
          AND to_regclass('public.audit_events') IS NOT NULL
          AND to_regclass('public.automation_job_executions') IS NOT NULL
          AND to_regclass('public.notifications') IS NOT NULL
          AND to_regclass('public.operational_work_items') IS NOT NULL
          AND to_regclass('public.migration_runs') IS NOT NULL
          AND to_regclass('public.migration_sources') IS NOT NULL
          AND to_regclass('public.migration_diagnostics') IS NOT NULL
          AND to_regclass('public.migration_reconciliations') IS NOT NULL AS schema_ready,
        EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis_ready,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'facilities'
            AND indexname = 'facilities_geography_gist' AND indexdef ILIKE '%USING gist%'
        ) AS spatial_index_ready`);
    observeDuration('provider_tracker_database_query_duration_ms', performance.now() - started, { operation: 'readiness' });
    const row = result.rows[0];
    const checks = {
      connection: true,
      schema: row?.schema_ready === true,
      postgis: row?.postgis_ready === true,
      spatialIndex: row?.spatial_index_ready === true,
    };
    return { ok: Object.values(checks).every(Boolean), checks };
  } catch (error) {
    incrementMetric('provider_tracker_database_failures_total', { operation: 'readiness' });
    logEvent('warn', 'database.readiness-failed', safeErrorFields(error));
    return failed;
  }
}

export function getDatabasePoolStats(): { total: number; idle: number; waiting: number; max: number } {
  const pool = sharedPool;
  return {
    total: pool?.totalCount ?? 0,
    idle: pool?.idleCount ?? 0,
    waiting: pool?.waitingCount ?? 0,
    max: getServerConfig().DATABASE_POOL_SIZE,
  };
}

export async function closeDatabasePool(): Promise<void> {
  const pool = sharedPool;
  sharedPool = null;
  if (pool) await pool.end();
}
