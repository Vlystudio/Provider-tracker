import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL is required.');
const allowedActions = [
  'admin.bootstrap', 'auth.sign-in', 'auth.sign-out',
  'authorization.update', 'authorization.delete',
  'facility.verification.create', 'facility.contact-attempt.create', 'facility.update',
  'facility.duplicates.refresh', 'facility.duplicate.decision', 'facility.merge',
  'reverification.bulk-assign', 'user.create', 'user.role-change', 'user.password-reset',
  'user.deactivate', 'user.activate', 'workbook.import.applied',
];

const pool = new pg.Pool({ connectionString, max: 1, statement_timeout: 20_000 });
try {
  const exists = await pool.query<{ exists: boolean }>(`SELECT to_regclass('public.audit_events') IS NOT NULL AS exists`);
  if (!exists.rows[0]?.exists) throw new Error('audit_events table is missing.');
  const result = await pool.query<{
    missing_actor: number;
    invalid_timestamp: number;
    unknown_action: number;
    broken_actor: number;
    detached_actor: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE result='success' AND actor_id IS NULL
        AND NOT (action IN ('auth.sign-in','auth.sign-out') AND entity_type='session' AND entity_id IS NOT NULL))::int AS missing_actor,
      count(*) FILTER (WHERE created_at IS NULL OR created_at > now()+interval '5 minutes')::int AS invalid_timestamp,
      count(*) FILTER (WHERE NOT (action = ANY($1::text[])))::int AS unknown_action,
      count(*) FILTER (WHERE actor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE users.id=audit_events.actor_id))::int AS broken_actor,
      count(*) FILTER (WHERE result='success' AND actor_id IS NULL
        AND action IN ('auth.sign-in','auth.sign-out') AND entity_type='session' AND entity_id IS NOT NULL)::int AS detached_actor
    FROM audit_events`, [allowedActions]);
  const checks: Record<string, number> = {
    missingActorForSuccessfulEvent: result.rows[0]?.missing_actor ?? 0,
    invalidTimestamp: result.rows[0]?.invalid_timestamp ?? 0,
    unknownAction: result.rows[0]?.unknown_action ?? 0,
    brokenActorReference: result.rows[0]?.broken_actor ?? 0,
  };
  const historicalTargets: Record<string, number> = {};
  historicalTargets.detachedSessionActor = result.rows[0]?.detached_actor ?? 0;
  for (const [entityType, table] of [['user','users'],['facility','facilities'],['authorization','authorizations']] as const) {
    const tableExists = await pool.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${table}`]);
    if (!tableExists.rows[0]?.exists) continue;
    const broken = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM audit_events e WHERE e.entity_type=$1 AND e.entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${table}" target WHERE target.id::text=e.entity_id)`, [entityType]);
    historicalTargets[`missing${entityType[0]?.toUpperCase()}${entityType.slice(1)}Target`] = broken.rows[0]?.count ?? 0;
  }
  const status = Object.values(checks).every((count) => count === 0) ? 'PASS' : 'FAIL';
  process.stdout.write(`${JSON.stringify({
    status,
    checks,
    historicalTargets,
    note: 'Historical target rows may be removed later; counts remain visible for investigation and do not rewrite audit history.',
    readOnly: true,
  }, null, 2)}\n`);
  if (status !== 'PASS') process.exitCode = 1;
} finally {
  await pool.end();
}
