import 'dotenv/config';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL?.trim();
const environment = process.env.TARGET_ENVIRONMENT?.trim();
if (!connectionString) throw new Error('DATABASE_URL is required.');
if (!['development', 'test', 'staging', 'production'].includes(environment ?? '')) {
  throw new Error('TARGET_ENVIRONMENT must be development, test, staging, or production.');
}
const database = new URL(connectionString).pathname.replace(/^\//, '');
if ((environment === 'staging' || environment === 'production') && process.env.CONFIRM_DATABASE !== database) {
  throw new Error(`Set CONFIRM_DATABASE=${database} to confirm the target database.`);
}
if (environment === 'production') {
  const backup = process.env.BACKUP_FILE?.trim();
  if (!backup || !path.isAbsolute(backup)) throw new Error('Production preflight requires an absolute BACKUP_FILE path.');
  await access(backup);
}

const migrationDirectory = path.resolve('drizzle');
const migrationFiles = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
if (!migrationFiles.length) throw new Error('No migration files were found.');
const hashes = await Promise.all(migrationFiles.map(async (name) => ({
  name,
  sha256: createHash('sha256').update(await readFile(path.join(migrationDirectory, name))).digest('hex'),
})));
const journal = JSON.parse(await readFile(path.join(migrationDirectory, 'meta', '_journal.json'), 'utf8')) as { entries?: Array<{ tag: string }> };
const journalTags = new Set(journal.entries?.map((entry) => `${entry.tag}.sql`) ?? []);
const missingFromJournal = migrationFiles.filter((name) => !journalTags.has(name));
if (missingFromJournal.length) throw new Error(`Migration journal is missing: ${missingFromJournal.join(', ')}`);

const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
try {
  const identity = await pool.query<{
    database: string;
    user_name: string;
    server_version: string;
    postgis: boolean;
    schema_usage: boolean;
    schema_create: boolean;
    migration_table: boolean;
  }>(`
    SELECT current_database() AS database, current_user AS user_name,
      current_setting('server_version') AS server_version,
      EXISTS (SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis,
      has_schema_privilege(current_user,'public','USAGE') AS schema_usage,
      has_schema_privilege(current_user,'public','CREATE') AS schema_create,
      to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS migration_table`);
  const row = identity.rows[0];
  if (!row || row.database !== database) throw new Error('Connected database identity does not match DATABASE_URL.');
  if (!row.postgis) throw new Error('PostGIS extension is required before migrations run.');
  if (!row.schema_usage || !row.schema_create) throw new Error('The migration role lacks USAGE or CREATE on the public schema.');
  const applied = row.migration_table
    ? await pool.query<{ count: number; latest: string | null }>('SELECT count(*)::int AS count, max(created_at)::text AS latest FROM drizzle.__drizzle_migrations')
    : { rows: [{ count: 0, latest: null }] };
  const appliedCount = applied.rows[0]?.count ?? 0;
  if (appliedCount > migrationFiles.length) throw new Error('Database migration history is ahead of this checkout. Stop and investigate schema drift.');
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    target: { environment, database: row.database, user: row.user_name, serverVersion: row.server_version },
    postgis: 'available',
    permissions: { schemaUsage: row.schema_usage, schemaCreate: row.schema_create },
    migrations: { localCount: migrationFiles.length, appliedCount, pendingCount: migrationFiles.length - appliedCount, latestAppliedAt: applied.rows[0]?.latest, hashes },
    backupGate: environment === 'production' ? 'verified-path-present' : 'not-required-by-script',
  }, null, 2)}\n`);
} finally {
  await pool.end();
}
