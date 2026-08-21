import 'dotenv/config';
import pg from 'pg';
import { housekeepingCutoffs, resolveHousekeepingPolicy } from '../src/server/housekeeping';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL is required.');
const database = new URL(connectionString).pathname.replace(/^\//, '');
const apply = process.argv.includes('--apply');
const environment = process.env.TARGET_ENVIRONMENT ?? 'development';
if (!database.endsWith('_test') && process.env.CONFIRM_DATABASE !== database) {
  throw new Error(`Set CONFIRM_DATABASE=${database} before housekeeping a non-test database.`);
}
if (environment === 'production' && process.env.HOUSEKEEPING_APPROVAL !== 'approved') {
  throw new Error('Production cleanup requires HOUSEKEEPING_APPROVAL=approved.');
}

const policy = resolveHousekeepingPolicy();
const cutoffs = housekeepingCutoffs(new Date(), policy);
const pool = new pg.Pool({ connectionString, max: 1, statement_timeout: 30_000 });

const jobs = [
  { name: 'expired sessions', table: 'sessions', column: 'expires_at', cutoff: cutoffs.sessionsBefore },
  { name: 'expired verification tokens', table: 'verification_tokens', column: 'expires_at', cutoff: cutoffs.tokensBefore },
  { name: 'inactive rate-limit buckets', table: 'auth_rate_limits', column: 'last_request', cutoff: cutoffs.rateLimitsBeforeEpochMs },
] as const;

try {
  const results = [];
  for (const job of jobs) {
    const exists = await pool.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${job.table}`]);
    if (!exists.rows[0]?.exists) {
      results.push({ item: job.name, status: 'table_not_present', rows: 0 });
      continue;
    }
    if (apply) {
      const deleted = await pool.query(`WITH batch AS (
        SELECT id FROM "${job.table}" WHERE "${job.column}" < $1 ORDER BY "${job.column}" LIMIT $2
      ) DELETE FROM "${job.table}" target USING batch WHERE target.id=batch.id RETURNING target.id`, [job.cutoff, policy.batchSize]);
      results.push({ item: job.name, status: 'deleted', rows: deleted.rowCount ?? 0 });
    } else {
      const count = await pool.query<{ count: number }>(`SELECT least(count(*)::int,$2::int)::int AS count FROM "${job.table}" WHERE "${job.column}" < $1`, [job.cutoff, policy.batchSize]);
      results.push({ item: job.name, status: 'dry_run', rows: count.rows[0]?.count ?? 0 });
    }
  }
  process.stdout.write(`${JSON.stringify({ status: 'PASS', mode: apply ? 'apply' : 'dry-run', database, policy, results, retained: ['audit_events', 'facility_verification_events', 'facility_contact_attempts', 'facility_merge_records', 'import_batches'] }, null, 2)}\n`);
} finally {
  await pool.end();
}
