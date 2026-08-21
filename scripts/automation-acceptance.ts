import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { applyCoverageObservation } from '../src/server/automation-jobs';
import { runAutomationJob } from '../src/server/automation-runner';
import { closeDatabasePool } from '../src/server/database';

const databaseUrl = process.env.AUTOMATION_TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('AUTOMATION_TEST_DATABASE_URL or DATABASE_URL is required.');
if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) throw new Error('Automation acceptance only runs against a database whose name ends in _test.');

const pool = new Pool({ connectionString: databaseUrl });
const runId = randomBytes(6).toString('hex');
const keyPrefix = `acceptance:${runId}`;
const results: Array<{ scenario: string; pass: boolean; detail: string }> = [];

function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }

async function readWatch(client: PoolClient, id: string) {
  const result = await client.query('SELECT * FROM coverage_watches WHERE id=$1', [id]);
  return result.rows[0];
}

async function main() {
  const client = await pool.connect();
  let adminId = '';
  let userId = '';
  let facilityId = '';
  let baselineFacilityId = '';
  let watchId = '';
  try {
    const people = await client.query<{ id: string; role: 'admin' | 'ura_user' }>(`
      INSERT INTO users (name,email,email_verified,initials,role)
      VALUES ('Automation Admin',$1,true,'AA','admin'),('Automation User',$2,true,'AU','ura_user') RETURNING id,role`,
    [`automation-admin-${runId}@example.invalid`, `automation-user-${runId}@example.invalid`]);
    adminId = people.rows.find((row) => row.role === 'admin')!.id;
    userId = people.rows.find((row) => row.role === 'ura_user')!.id;
    const specialty = await client.query<{ id: string }>(`INSERT INTO specialties (canonical_name,normalized_name) VALUES ($1,$2) RETURNING id`, [`Automation Oncology ${runId}`, `automation-oncology-${runId}`]);
    const facility = await client.query<{ id: string }>(`
      INSERT INTO facilities
        (facility_name,city,normalized_name,normalized_city,display_key,phone_raw,phone_normalized,postal_code,last_verified_at,accepting_verified_at,current_accepting_status,latitude,longitude)
      VALUES ($1,'Portland',$2,'portland',$3,'207-555-0199','2075550199','04103',now()-interval '120 days',now()-interval '120 days','yes',43.66,-70.25)
      RETURNING id`, [`Automation Clinic ${runId}`, `automation-clinic-${runId}`, `Automation Clinic ${runId}|Portland`]);
    facilityId = facility.rows[0].id;
    await client.query(`INSERT INTO reverification_assignments (facility_id,assigned_to,status,reason_codes) VALUES ($1,$2,'open','["stale"]')`, [facilityId, userId]);

    const first = await runAutomationJob('reverification_scan', { executionKey: `${keyPrefix}:stale:1`, trigger: 'manual' });
    let work = await client.query<{ count: number; status: string }>(`SELECT count(*)::int AS count,max(status::text) AS status FROM operational_work_items WHERE deduplication_key=$1`, [`reverification:${facilityId}`]);
    let notification = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM notifications WHERE recipient_id=$1 AND issue_key IN (SELECT 'work:'||id FROM operational_work_items WHERE deduplication_key=$2)`, [userId, `reverification:${facilityId}`]);
    record('Stale facility creates work', first.result === 'succeeded' && work.rows[0].count === 1, `work=${work.rows[0].count}`);
    record('Stale facility notifies assignee once', notification.rows[0].count === 1, `notifications=${notification.rows[0].count}`);

    await runAutomationJob('reverification_scan', { executionKey: `${keyPrefix}:stale:2`, trigger: 'manual' });
    work = await client.query<{ count: number; status: string }>(`SELECT count(*)::int AS count,max(status::text) AS status FROM operational_work_items WHERE deduplication_key=$1`, [`reverification:${facilityId}`]);
    notification = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM notifications WHERE recipient_id=$1 AND issue_key IN (SELECT 'work:'||id FROM operational_work_items WHERE deduplication_key=$2)`, [userId, `reverification:${facilityId}`]);
    record('Repeated stale scan is idempotent', work.rows[0].count === 1 && notification.rows[0].count === 1, `work=${work.rows[0].count}, notifications=${notification.rows[0].count}`);

    const versionBeforeRace = await client.query<{ optimistic_lock_version: number }>('SELECT optimistic_lock_version FROM operational_work_items WHERE deduplication_key=$1', [`reverification:${facilityId}`]);
    await Promise.all([
      client.query(`UPDATE operational_work_items SET status='completed',completed_at=now(),optimistic_lock_version=optimistic_lock_version+1,updated_at=now() WHERE deduplication_key=$1 AND optimistic_lock_version=$2`, [`reverification:${facilityId}`, versionBeforeRace.rows[0].optimistic_lock_version]),
      runAutomationJob('reverification_scan', { executionKey: `${keyPrefix}:stale:race`, trigger: 'manual' }),
    ]);
    const workAfterRace = await client.query<{ count: number; status: string }>(`SELECT count(*)::int AS count,max(status::text) AS status FROM operational_work_items WHERE deduplication_key=$1`, [`reverification:${facilityId}`]);
    record('Interactive completion during scan keeps one coherent item', workAfterRace.rows[0].count === 1 && ['open', 'assigned', 'in_progress', 'completed'].includes(workAfterRace.rows[0].status), `work=${workAfterRace.rows[0].count}, status=${workAfterRace.rows[0].status}`);

    await client.query(`UPDATE facilities SET last_verified_at=now(), accepting_verified_at=now() WHERE id=$1`, [facilityId]);
    await runAutomationJob('reverification_scan', { executionKey: `${keyPrefix}:stale:3`, trigger: 'manual' });
    work = await client.query<{ count: number; status: string }>(`SELECT count(*)::int AS count,max(status::text) AS status FROM operational_work_items WHERE deduplication_key=$1`, [`reverification:${facilityId}`]);
    record('Fresh verification resolves derived work', work.rows[0].status === 'completed', `status=${work.rows[0].status}`);

    const watch = await client.query<{ id: string }>(`
      INSERT INTO coverage_watches (name,specialty_id,postal_code,radius_miles,minimum_count,freshness_days,created_by)
      VALUES ($1,$2,'04103',50,2,45,$3) RETURNING id`, [`Automation watch ${runId}`, specialty.rows[0].id, adminId]);
    watchId = watch.rows[0].id;
    let state = await readWatch(client, watchId);
    await applyCoverageObservation(client, state, 3, new Date());
    state = await readWatch(client, watchId);
    record('Coverage watch starts healthy', state.state === 'healthy' && state.cycle === 0, `state=${state.state}, cycle=${state.cycle}`);
    await applyCoverageObservation(client, state, 1, new Date());
    state = await readWatch(client, watchId);
    const afterOpen = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM coverage_alert_events WHERE watch_id=$1`, [watchId]);
    record('Coverage threshold crossing opens an alert', state.state === 'alerting' && state.cycle === 1 && afterOpen.rows[0].count === 1, `state=${state.state}, events=${afterOpen.rows[0].count}`);
    await applyCoverageObservation(client, state, 1, new Date());
    const afterRepeat = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM coverage_alert_events WHERE watch_id=$1`, [watchId]);
    record('Continuing coverage gap does not spam', afterRepeat.rows[0].count === 1, `events=${afterRepeat.rows[0].count}`);
    state = await readWatch(client, watchId);
    await applyCoverageObservation(client, state, 2, new Date());
    state = await readWatch(client, watchId);
    const afterResolve = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM coverage_alert_events WHERE watch_id=$1`, [watchId]);
    record('Coverage recovery records resolution', state.state === 'healthy' && afterResolve.rows[0].count === 2, `state=${state.state}, events=${afterResolve.rows[0].count}`);
    await applyCoverageObservation(client, state, 0, new Date());
    state = await readWatch(client, watchId);
    const afterReopen = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM coverage_alert_events WHERE watch_id=$1`, [watchId]);
    record('Recurring coverage gap starts a new cycle', state.state === 'alerting' && state.cycle === 2 && afterReopen.rows[0].count === 3, `cycle=${state.cycle}, events=${afterReopen.rows[0].count}`);

    const baselineFacility = await client.query<{ id: string }>(`
      INSERT INTO facilities
        (facility_name,city,normalized_name,normalized_city,display_key,data_quality_status,migration_baseline_at,updated_at)
      VALUES ($1,'Portland',$2,'portland',$3,'needs_review',now(),now()) RETURNING id`,
    [`Migrated Baseline Clinic ${runId}`, `migrated-baseline-clinic-${runId}`, `Migrated Baseline Clinic ${runId}|Portland`]);
    baselineFacilityId = baselineFacility.rows[0].id;
    await runAutomationJob('data_quality_scan', { executionKey: `${keyPrefix}:baseline:1`, trigger: 'manual' });
    let baselineWork = await client.query<{ id: string; cycle: number }>(`SELECT id,cycle FROM operational_work_items WHERE deduplication_key=$1`, [`data_quality:${baselineFacilityId}`]);
    let baselineNotifications = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM notifications WHERE issue_key=$1`, [`work:${baselineWork.rows[0]?.id}`]);
    record('Migrated backlog creates work without an initial alert', baselineWork.rows.length === 1 && baselineNotifications.rows[0].count === 0, `work=${baselineWork.rows.length}, notifications=${baselineNotifications.rows[0].count}`);
    await client.query(`UPDATE operational_work_items SET status='completed',completed_at=now(),updated_at=now() WHERE id=$1`, [baselineWork.rows[0].id]);
    await client.query(`UPDATE facilities SET updated_at=migration_baseline_at + interval '10 minutes' WHERE id=$1`, [baselineFacilityId]);
    await runAutomationJob('data_quality_scan', { executionKey: `${keyPrefix}:baseline:2`, trigger: 'manual' });
    baselineWork = await client.query<{ id: string; cycle: number }>(`SELECT id,cycle FROM operational_work_items WHERE deduplication_key=$1`, [`data_quality:${baselineFacilityId}`]);
    baselineNotifications = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM notifications WHERE issue_key=$1`, [`work:${baselineWork.rows[0]?.id}`]);
    record('Later work cycle follows normal notification rules', baselineWork.rows[0].cycle === 2 && baselineNotifications.rows[0].count === 1, `cycle=${baselineWork.rows[0].cycle}, notifications=${baselineNotifications.rows[0].count}`);

    const concurrentKey = `${keyPrefix}:concurrent`;
    const concurrent = await Promise.all([
      runAutomationJob('data_quality_scan', { executionKey: concurrentKey, trigger: 'manual', dryRun: true }),
      runAutomationJob('data_quality_scan', { executionKey: concurrentKey, trigger: 'manual', dryRun: true }),
    ]);
    const executions = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM automation_job_executions WHERE execution_key=$1', [concurrentKey]);
    record('Concurrent identical execution runs once', executions.rows[0].count === 1 && concurrent.filter((item) => item.deduplicated).length === 1, `executions=${executions.rows[0].count}, deduplicated=${concurrent.filter((item) => item.deduplicated).length}`);

    const notificationKey = `${keyPrefix}:notification-retry`;
    const retryInsert = `INSERT INTO notifications (recipient_id,type,category,severity,title,message,target_path,source,deduplication_key) VALUES ($1,'test','work','informational','Test','Test','/work','automation_acceptance',$2) ON CONFLICT (recipient_id,deduplication_key) DO NOTHING`;
    await Promise.all([client.query(retryInsert, [userId, notificationKey]), pool.query(retryInsert, [userId, notificationKey])]);
    const notificationRetries = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM notifications WHERE recipient_id=$1 AND deduplication_key=$2', [userId, notificationKey]);
    record('Concurrent notification retry is deduplicated', notificationRetries.rows[0].count === 1, `notifications=${notificationRetries.rows[0].count}`);

    const scheduledFor = new Date();
    await runAutomationJob('daily_digest', { executionKey: `${keyPrefix}:digest:1`, scheduledFor, trigger: 'manual' });
    await runAutomationJob('daily_digest', { executionKey: `${keyPrefix}:digest:2`, scheduledFor, trigger: 'manual' });
    const digests = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM operational_digests WHERE recipient_id=$1 AND digest_type='daily'`, [userId]);
    record('Digest retry does not duplicate the period', digests.rows[0].count === 1, `digests=${digests.rows[0].count}`);

    const executionHistory = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM automation_job_executions WHERE execution_key LIKE $1`, [`${keyPrefix}:%`]);
    record('Job execution history is persistent', executionHistory.rows[0].count >= 9, `executions=${executionHistory.rows[0].count}`);
  } finally {
    await client.query('DELETE FROM notifications WHERE source=$1 OR deduplication_key LIKE $2', ['automation_acceptance', `${keyPrefix}:%`]).catch(() => undefined);
    if (watchId) await client.query('DELETE FROM coverage_watches WHERE id=$1', [watchId]).catch(() => undefined);
    if (facilityId) {
      await client.query('DELETE FROM operational_work_items WHERE target_id=$1', [facilityId]).catch(() => undefined);
      await client.query('DELETE FROM reverification_assignments WHERE facility_id=$1', [facilityId]).catch(() => undefined);
      await client.query('DELETE FROM facilities WHERE id=$1', [facilityId]).catch(() => undefined);
    }
    if (baselineFacilityId) {
      await client.query('DELETE FROM operational_work_items WHERE target_id=$1', [baselineFacilityId]).catch(() => undefined);
      await client.query('DELETE FROM facilities WHERE id=$1', [baselineFacilityId]).catch(() => undefined);
    }
    await client.query('DELETE FROM operational_digests WHERE audience_key IN ($1,$2)', [`user:${adminId}`, `user:${userId}`]).catch(() => undefined);
    await client.query('DELETE FROM automation_job_executions WHERE execution_key LIKE $1', [`${keyPrefix}:%`]).catch(() => undefined);
    await client.query('DELETE FROM specialties WHERE normalized_name=$1', [`automation-oncology-${runId}`]).catch(() => undefined);
    if (userId || adminId) await client.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[userId, adminId].filter(Boolean)]).catch(() => undefined);
    client.release();
  }

  console.table(results);
  const failed = results.filter((result) => !result.pass);
  if (failed.length) throw new Error(`${failed.length} automation acceptance scenario(s) failed.`);
  process.stdout.write(`${results.length}/${results.length} automation scenarios passed.\n`);
}

try { await main(); }
finally { await Promise.all([pool.end(), closeDatabasePool()]); }
