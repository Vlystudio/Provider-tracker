import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { parseDatabaseTarget, resolvePostgresTool, runPostgresTool, type DatabaseTarget } from './lib/postgres-tools';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL is required.');
const source = parseDatabaseTarget(connectionString);
if (!source.database.endsWith('_test')) throw new Error('Restore acceptance only runs when the source database name ends in _test.');

const targetDatabase = process.env.RESTORE_TARGET_DATABASE?.trim() ?? `${source.database.replace(/_test$/, '')}_restore_test`;
if (!/^[a-zA-Z0-9_]+_restore_test$/.test(targetDatabase) || targetDatabase === source.database) {
  throw new Error('RESTORE_TARGET_DATABASE must be a different database whose name ends in _restore_test.');
}

const restored: DatabaseTarget = { ...source, database: targetDatabase };
const pgDump = await resolvePostgresTool('pg_dump');
const pgRestore = await resolvePostgresTool('pg_restore');
const createDb = await resolvePostgresTool('createdb');
const dropDb = await resolvePostgresTool('dropdb');
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-tracker-restore-'));
const backupPath = path.join(temporaryDirectory, 'acceptance.dump');

const criticalTables = [
  'users',
  'accounts',
  'sessions',
  'facilities',
  'facility_specialties',
  'facility_diagnosis_capabilities',
  'facility_verification_events',
  'facility_contact_attempts',
  'facility_duplicate_candidates',
  'facility_merge_records',
  'report_snapshots',
  'import_batches',
  'migration_runs',
  'migration_sources',
  'migration_diagnostics',
  'migration_reconciliations',
  'legacy_actors',
  'legacy_value_mappings',
  'audit_events',
  'access_review_decisions',
  'data_retention_policies',
  'data_retention_holds',
  'automation_job_executions',
  'notification_preferences',
  'notifications',
  'operational_work_items',
  'operational_change_events',
  'coverage_watches',
  'coverage_alert_events',
  'operational_digests',
  'automation_settings',
];

async function tableCounts(pool: pg.Pool): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of criticalTables) {
    const exists = await pool.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${table}`]);
    if (exists.rows[0]?.exists) {
      const result = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM "${table}"`);
      counts[table] = result.rows[0]?.count ?? 0;
    }
  }
  return counts;
}

let sourcePool: pg.Pool | undefined;
let restoredPool: pg.Pool | undefined;
try {
  await runPostgresTool(pgDump, ['--format=custom', '--compress=6', '--no-owner', '--no-acl', '--file', backupPath], source);
  const dump = await readFile(backupPath);
  const checksum = createHash('sha256').update(dump).digest('hex');
  if (dump.byteLength < 1_024) throw new Error('Backup artifact is unexpectedly small.');

  sourcePool = new pg.Pool({ connectionString, max: 1 });
  const sourceCounts = await tableCounts(sourcePool);
  const required = [
    'users',
    'accounts',
    'facilities',
    'facility_verification_events',
    'facility_contact_attempts',
    'migration_runs',
    'migration_sources',
    'migration_diagnostics',
    'migration_reconciliations',
    'legacy_actors',
    'legacy_value_mappings',
    'audit_events',
    'access_review_decisions',
    'data_retention_policies',
    'data_retention_holds',
  ];
  const missing = required.filter((table) => !(table in sourceCounts));
  if (missing.length) throw new Error(`Source test database is missing critical tables: ${missing.join(', ')}`);

  await runPostgresTool(dropDb, ['--if-exists', '--force', targetDatabase], source);
  await runPostgresTool(createDb, ['--template=template0', targetDatabase], source);
  await runPostgresTool(pgRestore, ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', targetDatabase, backupPath], restored);

  const restoredUrl = new URL(connectionString);
  restoredUrl.pathname = `/${targetDatabase}`;
  restoredPool = new pg.Pool({ connectionString: restoredUrl.toString(), max: 1 });
  const restoredCounts = await tableCounts(restoredPool);
  if (JSON.stringify(restoredCounts) !== JSON.stringify(sourceCounts)) {
    throw new Error(`Restored row counts differ from the source. source=${JSON.stringify(sourceCounts)} restored=${JSON.stringify(restoredCounts)}`);
  }
  const authIntegrity = await restoredPool.query<{ valid: boolean }>(`
    SELECT NOT EXISTS (
      SELECT 1 FROM accounts a LEFT JOIN users u ON u.id=a.user_id WHERE u.id IS NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM sessions s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL
    ) AS valid`);
  if (!authIntegrity.rows[0]?.valid) throw new Error('Restored authentication relationships are invalid.');

  const postgis = await restoredPool.query<{ available: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='postgis') AS available`);
  if (postgis.rows[0]?.available) {
    await restoredPool.query(`SELECT ST_Distance(ST_SetSRID(ST_MakePoint(-70.29,43.68),4326)::geography, ST_SetSRID(ST_MakePoint(-70.28,43.68),4326)::geography)`);
  }
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    checksum,
    bytes: dump.byteLength,
    tables: sourceCounts,
    authenticationRelationships: 'PASS',
    postgisRestore: postgis.rows[0]?.available ? 'PASS' : 'NOT_PRESENT_IN_SOURCE',
  }, null, 2)}\n`);
} finally {
  await sourcePool?.end().catch(() => undefined);
  await restoredPool?.end().catch(() => undefined);
  await runPostgresTool(dropDb, ['--if-exists', '--force', targetDatabase], source).catch(() => undefined);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
