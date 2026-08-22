import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import pg from 'pg';

const connectionString = process.env.GOVERNANCE_TEST_DATABASE_URL?.trim()
  || process.env.SECURITY_TEST_DATABASE_URL?.trim();
if (!connectionString) throw new Error('GOVERNANCE_TEST_DATABASE_URL or SECURITY_TEST_DATABASE_URL is required.');
const database = new URL(connectionString).pathname.replace(/^\//, '');
if (!database.endsWith('_test')) throw new Error('Governance performance runs only against a database ending in _test.');
const pool = new pg.Pool({ connectionString, max: 1, statement_timeout: 30_000 });
const sampleSize = 100_000;

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const schema = await client.query<{ ready: boolean }>(`
      SELECT to_regclass('public.users') IS NOT NULL
        AND to_regclass('public.audit_events') IS NOT NULL
        AND to_regclass('public.access_review_decisions') IS NOT NULL
        AND to_regclass('public.data_retention_policies') IS NOT NULL
        AND to_regclass('public.data_retention_holds') IS NOT NULL AS ready`);
    if (!schema.rows[0]?.ready) throw new Error('Phase 10 governance tables are missing.');

    const userId = randomUUID();
    await client.query(`INSERT INTO users(id,name,email,email_verified,initials,role,is_active,is_service_account,role_assigned_at)
      VALUES($1,'Governance Performance User',$2,true,'GP','ura_user',true,false,now())`, [userId, `governance-${userId}@example.invalid`]);
    const insertStarted = performance.now();
    await client.query(`INSERT INTO audit_events(actor_id,action,result,entity_type,entity_id,metadata,created_at)
      SELECT $1,
        CASE WHEN sequence % 20=0 THEN 'authorization.denied' ELSE 'provider.search' END,
        CASE WHEN sequence % 20=0 THEN 'blocked' ELSE 'success' END,
        'provider_search',sequence::text,'{}'::jsonb,now()-(sequence || ' seconds')::interval
      FROM generate_series(1,$2) sequence`, [userId, sampleSize]);
    const insertMs = performance.now() - insertStarted;

    const incidentStarted = performance.now();
    const incident = await client.query(`SELECT action,result,entity_type,entity_id,created_at
      FROM audit_events WHERE actor_id=$1 AND created_at >= now()-interval '2 days'
      ORDER BY created_at DESC LIMIT 500`, [userId]);
    const incidentMs = performance.now() - incidentStarted;
    const pageStarted = performance.now();
    const page = await client.query(`SELECT id,action,result,created_at FROM audit_events
      WHERE actor_id=$1 ORDER BY created_at DESC LIMIT 100 OFFSET 50000`, [userId]);
    const pageMs = performance.now() - pageStarted;

    await client.query(`INSERT INTO access_review_decisions
      (review_period,reviewed_user_id,reviewer_id,reviewed_role,account_active,last_signed_in_at,decision)
      VALUES('2026-Q3',$1,$1,'ura_user',true,now(),'retain')`, [userId]);
    const recovered = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM access_review_decisions WHERE reviewed_user_id=$1`, [userId]);

    const status = incident.rows.length === 500 && page.rows.length === 100
      && recovered.rows[0]?.count === 1 && incidentMs < 10_000 && pageMs < 10_000 ? 'PASS' : 'FAIL';
    process.stdout.write(`${JSON.stringify({
      status,
      database,
      syntheticAuditEvents: sampleSize,
      accessReviewRowsRecovered: recovered.rows[0]?.count ?? 0,
      timingsMs: {
        insert: Number(insertMs.toFixed(1)),
        incidentQuery: Number(incidentMs.toFixed(1)),
        deepPageQuery: Number(pageMs.toFixed(1)),
      },
      rows: { incident: incident.rows.length, deepPage: page.rows.length },
      transaction: 'rolled_back',
    }, null, 2)}\n`);
    if (status === 'FAIL') process.exitCode = 1;
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
