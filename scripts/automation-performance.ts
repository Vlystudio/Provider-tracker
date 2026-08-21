import 'dotenv/config';

import { Pool } from 'pg';

const databaseUrl = process.env.AUTOMATION_TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('AUTOMATION_TEST_DATABASE_URL or DATABASE_URL is required.');
if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) throw new Error('Automation performance tests only run against a database whose name ends in _test.');

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const datasetSize = Math.max(10_000, Math.min(50_000, Number(process.env.AUTOMATION_BENCHMARK_SIZE ?? 10_000)));

async function main() {
  const client = await pool.connect();
  const timings: Array<{ operation: string; rows: number; durationMs: number }> = [];
  async function measure(operation: string, query: string, parameters: unknown[] = []) {
    const started = performance.now();
    const result = await client.query(query, parameters);
    const rows = result.command === 'SELECT' ? Number(result.rows[0]?.count ?? result.rowCount ?? 0) : result.rowCount ?? 0;
    timings.push({ operation, rows, durationMs: Math.round((performance.now() - started) * 10) / 10 });
    return result;
  }
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE automation_benchmark_facilities AS
      SELECT
        g AS id,
        CASE WHEN g % 1000 IN (0,1) THEN 'duplicate-' || floor(g / 1000)::text ELSE 'facility-' || g::text END AS normalized_name,
        CASE WHEN g % 1000 IN (0,1) THEN 'duplicate-city-' || floor(g / 1000)::text ELSE 'city-' || (g % 120)::text END AS normalized_city,
        CASE WHEN g % 25 = 0 THEN NULL ELSE lpad((2070000000 + g)::text,10,'0') END AS phone_normalized,
        CASE WHEN g % 10 = 0 THEN NULL ELSE now() - ((g % 180)::text || ' days')::interval END AS last_verified_at,
        CASE WHEN g % 20 = 0 THEN NULL ELSE 43.0 + (g % 100)::double precision / 100 END AS latitude,
        CASE WHEN g % 20 = 0 THEN NULL ELSE -71.0 + (g % 100)::double precision / 100 END AS longitude,
        CASE WHEN g % 3 = 0 THEN 'yes' ELSE 'no' END AS accepting_status,
        true AS active
      FROM generate_series(1,$1) g`, [datasetSize]);
    await client.query('CREATE INDEX ON automation_benchmark_facilities(active,last_verified_at); CREATE INDEX ON automation_benchmark_facilities(phone_normalized); CREATE INDEX ON automation_benchmark_facilities(normalized_name,normalized_city);');
    await client.query(`CREATE TEMP TABLE automation_benchmark_work (deduplication_key text PRIMARY KEY, work_type text, target_id integer, reason text);`);

    await measure('stale_scan', `
      INSERT INTO automation_benchmark_work
      SELECT 'reverification:'||id, 'reverification', id, CASE WHEN last_verified_at IS NULL THEN 'never_verified' ELSE 'stale' END
      FROM automation_benchmark_facilities
      WHERE active=true AND (last_verified_at IS NULL OR last_verified_at < now()-interval '45 days')
      ON CONFLICT DO NOTHING`);
    await measure('quality_scan', `
      INSERT INTO automation_benchmark_work
      SELECT 'quality:'||id, 'data_quality', id, concat_ws(',',CASE WHEN phone_normalized IS NULL THEN 'missing_phone' END,CASE WHEN latitude IS NULL THEN 'missing_coordinates' END)
      FROM automation_benchmark_facilities
      WHERE active=true AND (phone_normalized IS NULL OR latitude IS NULL OR longitude IS NULL)
      ON CONFLICT DO NOTHING`);
    await measure('duplicate_detection', `
      SELECT count(*)::int AS count FROM (
        SELECT l.id,r.id FROM automation_benchmark_facilities l
        JOIN automation_benchmark_facilities r ON l.id<r.id AND (
          (l.phone_normalized IS NOT NULL AND l.phone_normalized=r.phone_normalized)
          OR (l.normalized_name=r.normalized_name AND l.normalized_city=r.normalized_city)
        ) LIMIT 5000
      ) pairs`);
    await measure('coverage_watch_evaluation', `
      SELECT count(*)::int AS count FROM automation_benchmark_facilities
      WHERE active=true AND accepting_status='yes' AND last_verified_at>=now()-interval '45 days'
        AND latitude BETWEEN 43.0 AND 43.9 AND longitude BETWEEN -71.0 AND -70.1`);

    await client.query(`
      CREATE TEMP TABLE automation_benchmark_changes AS
      SELECT g AS id, now()-((g%30)::text||' days')::interval AS occurred_at,
        CASE WHEN g%4=0 THEN 'stopped_accepting' ELSE 'wait_increased' END AS event_type
      FROM generate_series(1,$1) g`, [datasetSize * 2]);
    await client.query('CREATE INDEX ON automation_benchmark_changes(occurred_at,event_type)');
    await measure('digest_generation', `
      SELECT count(*)::int AS count,
        count(*) FILTER (WHERE event_type='stopped_accepting')::int AS stopped,
        (SELECT count(*)::int FROM automation_benchmark_work) AS open_work
      FROM automation_benchmark_changes WHERE occurred_at>=now()-interval '7 days'`);

    await client.query(`CREATE TEMP TABLE automation_benchmark_recipients AS SELECT g AS id FROM generate_series(1,1000) g; CREATE TEMP TABLE automation_benchmark_notifications (recipient_id integer,deduplication_key text,UNIQUE(recipient_id,deduplication_key));`);
    await measure('notification_generation', `
      INSERT INTO automation_benchmark_notifications SELECT id,'daily:'||current_date::text FROM automation_benchmark_recipients ON CONFLICT DO NOTHING`);
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  console.table(timings);
  const slow = timings.filter((entry) => entry.durationMs > 10_000);
  process.stdout.write(`${JSON.stringify({ datasetSize, timings, thresholdMs: 10_000, passed: slow.length === 0 }, null, 2)}\n`);
  if (slow.length) throw new Error(`Automation benchmark exceeded 10 seconds: ${slow.map((entry) => entry.operation).join(', ')}`);
}

try { await main(); }
finally { await pool.end(); }
