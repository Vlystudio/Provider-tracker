import 'dotenv/config';

import pg from 'pg';
import { retentionCategories } from '../src/lib/governance';
import { resolveHousekeepingExecutionPolicy, retentionCutoff } from '../src/server/housekeeping';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL is required.');
const database = new URL(connectionString).pathname.replace(/^\//, '');
const apply = process.argv.includes('--apply');
const environment = process.env.TARGET_ENVIRONMENT?.trim();
const actorId = process.env.HOUSEKEEPING_ACTOR_ID?.trim();
if (!database.endsWith('_test') && process.env.CONFIRM_DATABASE !== database) {
  throw new Error(`Set CONFIRM_DATABASE=${database} before housekeeping a non-test database.`);
}
if (apply && !environment) throw new Error('TARGET_ENVIRONMENT is required for destructive housekeeping.');
if (apply && process.env.HOUSEKEEPING_APPROVAL !== 'approved') {
  throw new Error('Destructive housekeeping requires HOUSEKEEPING_APPROVAL=approved.');
}
if (apply && !actorId) throw new Error('HOUSEKEEPING_ACTOR_ID is required for destructive housekeeping.');

const execution = resolveHousekeepingExecutionPolicy();
const pool = new pg.Pool({ connectionString, max: 1, statement_timeout: 30_000 });

try {
  const schema = await pool.query<{ ready: boolean }>(`
    SELECT to_regclass('public.data_retention_policies') IS NOT NULL
      AND to_regclass('public.data_retention_holds') IS NOT NULL
      AND to_regclass('public.audit_events') IS NOT NULL AS ready`);
  if (!schema.rows[0]?.ready) throw new Error('Phase 10 retention tables are missing. Apply database migrations first.');

  if (apply) {
    const actor = await pool.query<{ authorized: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM users WHERE id=$1 AND is_active=true AND (role='admin' OR is_service_account=true)
      ) AS authorized`, [actorId]);
    if (!actor.rows[0]?.authorized) throw new Error('HOUSEKEEPING_ACTOR_ID must identify an active administrator or service account.');
  }

  const policyRows = await pool.query<{
    category: string;
    retention_days: number;
    deletion_enabled: boolean;
    policy_reference: string | null;
    approved_by: string | null;
    approved_at: Date | null;
  }>('SELECT category,retention_days,deletion_enabled,policy_reference,approved_by,approved_at FROM data_retention_policies');
  const policies = new Map(policyRows.rows.map((policy) => [policy.category, policy]));
  const results = [];
  const now = new Date();

  for (const definition of retentionCategories) {
    const policy = policies.get(definition.key);
    if (!policy?.retention_days) {
      results.push({ category: definition.key, status: 'not_configured', eligible: 0, held: 0, deleted: 0 });
      continue;
    }
    const cutoff = retentionCutoff(now, policy.retention_days);
    const cutoffValue = definition.key === 'inactive_rate_limit_buckets' ? cutoff.getTime() : cutoff;
    const predicate = `target."${definition.dateColumn}" < $1`;
    const counts = await pool.query<{ eligible: number; held: number }>(`
      SELECT
        count(*) FILTER (WHERE ${predicate} AND NOT EXISTS (
          SELECT 1 FROM data_retention_holds hold WHERE hold.category=$2 AND hold.released_at IS NULL
            AND (hold.entity_id IS NULL OR (hold.entity_type=$3 AND hold.entity_id=target.id::text))
        ))::int AS eligible,
        count(*) FILTER (WHERE ${predicate} AND EXISTS (
          SELECT 1 FROM data_retention_holds hold WHERE hold.category=$2 AND hold.released_at IS NULL
            AND (hold.entity_id IS NULL OR (hold.entity_type=$3 AND hold.entity_id=target.id::text))
        ))::int AS held
      FROM "${definition.table}" target`, [cutoffValue, definition.key, definition.table]);

    if (!apply) {
      results.push({
        category: definition.key,
        status: 'dry_run',
        cutoff: cutoff.toISOString(),
        eligible: counts.rows[0]?.eligible ?? 0,
        held: counts.rows[0]?.held ?? 0,
        nextBatch: Math.min(counts.rows[0]?.eligible ?? 0, execution.batchSize),
        deleted: 0,
      });
      continue;
    }
    if (!policy.deletion_enabled || !policy.policy_reference || !policy.approved_by || !policy.approved_at) {
      results.push({
        category: definition.key,
        status: 'deletion_not_approved',
        cutoff: cutoff.toISOString(),
        eligible: counts.rows[0]?.eligible ?? 0,
        held: counts.rows[0]?.held ?? 0,
        deleted: 0,
      });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const deleted = await client.query(`WITH batch AS (
        SELECT target.id FROM "${definition.table}" target
        WHERE ${predicate} AND NOT EXISTS (
          SELECT 1 FROM data_retention_holds hold WHERE hold.category=$2 AND hold.released_at IS NULL
            AND (hold.entity_id IS NULL OR (hold.entity_type=$3 AND hold.entity_id=target.id::text))
        ) ORDER BY target."${definition.dateColumn}",target.id LIMIT $4
      ) DELETE FROM "${definition.table}" target USING batch WHERE target.id=batch.id RETURNING target.id`, [
        cutoffValue,
        definition.key,
        definition.table,
        execution.batchSize,
      ]);
      await client.query(`INSERT INTO audit_events(actor_id,action,result,entity_type,entity_id,metadata)
        VALUES($1,'retention.apply','success','retention_policy',$2,$3::jsonb)`, [
        actorId,
        definition.key,
        JSON.stringify({
          deleted: deleted.rowCount ?? 0,
          cutoff: cutoff.toISOString(),
          policyReference: policy.policy_reference,
          environment,
        }),
      ]);
      await client.query('COMMIT');
      results.push({
        category: definition.key,
        status: 'deleted',
        cutoff: cutoff.toISOString(),
        eligible: counts.rows[0]?.eligible ?? 0,
        held: counts.rows[0]?.held ?? 0,
        deleted: deleted.rowCount ?? 0,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    mode: apply ? 'apply' : 'dry-run',
    database,
    environment: environment ?? 'unspecified',
    batchSize: execution.batchSize,
    results,
    retainedByDesign: [
      'audit_events',
      'facility_verification_events',
      'facility_contact_attempts',
      'facility_merge_records',
      'import_batches',
      'migration_runs',
      'access_review_decisions',
    ],
  }, null, 2)}\n`);
} finally {
  await pool.end();
}
