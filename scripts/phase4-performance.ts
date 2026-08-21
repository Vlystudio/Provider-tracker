import 'dotenv/config';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.endsWith('_test')) throw new Error('The performance fixture only runs against a database whose name ends in _test.');

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

async function explain(name: string, statement: string, parameters: unknown[], targetMs: number) {
  const result = await client.query<{ 'QUERY PLAN': Array<{ 'Execution Time': number; Plan: { 'Node Type': string } }> }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`,
    parameters,
  );
  const plan = result.rows[0]?.['QUERY PLAN']?.[0];
  return { path: name, milliseconds: plan?.['Execution Time'] ?? Number.NaN, targetMs, pass: (plan?.['Execution Time'] ?? Infinity) <= targetMs, rootPlan: plan?.Plan?.['Node Type'] ?? 'unknown' };
}

try {
  const postgis = await client.query<{ available: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='postgis') AS available`);
  if (!postgis.rows[0]?.available) throw new Error('PostGIS is not enabled in the performance-test database.');
  await client.query('BEGIN');
  await client.query(`
    INSERT INTO specialties (canonical_name, normalized_name) VALUES ('Benchmark Oncology', 'benchmark oncology')
      ON CONFLICT (normalized_name) DO UPDATE SET canonical_name=excluded.canonical_name;
    INSERT INTO diagnoses (code, description) VALUES ('Z99.0', 'Synthetic benchmark diagnosis')
      ON CONFLICT (code) DO UPDATE SET description=excluded.description;
    INSERT INTO postal_code_centroids (zip_code, latitude, longitude, geog_point, source)
      VALUES ('04103', 43.68, -70.29, ST_SetSRID(ST_MakePoint(-70.29,43.68),4326), 'synthetic_benchmark')
      ON CONFLICT (zip_code) DO UPDATE SET geog_point=excluded.geog_point;
    INSERT INTO facilities (
      facility_name, city, normalized_name, normalized_city, display_key, address_line_1, state_code,
      phone_raw, phone_normalized, postal_code, latitude, longitude, geog_point, coordinate_quality,
      current_accepting_status, current_scheduling_status, accepting_verified_at, scheduling_verified_at,
      last_verified_at, source_metadata
    )
    SELECT
      'Benchmark Facility ' || g, 'Portland', 'benchmark facility ' || g, 'portland', 'Benchmark|' || g,
      g || ' Test Street', 'ME', '207555' || lpad(g::text,4,'0'), '207555' || lpad(g::text,4,'0'), '04103',
      43.68 + ((g % 100) - 50) * 0.003, -70.29 + ((g % 80) - 40) * 0.003,
      ST_SetSRID(ST_MakePoint(-70.29 + ((g % 80) - 40) * 0.003, 43.68 + ((g % 100) - 50) * 0.003),4326),
      'address', CASE WHEN g % 4 = 0 THEN 'no'::verification_answer ELSE 'yes'::verification_answer END,
      CASE WHEN g % 5 = 0 THEN 'no'::verification_answer ELSE 'yes'::verification_answer END,
      now() - ((g % 120) || ' days')::interval, now() - ((g % 120) || ' days')::interval,
      now() - ((g % 120) || ' days')::interval, jsonb_build_object('benchmark',true)
    FROM generate_series(1,5000) g;
    INSERT INTO facility_specialties (facility_id,specialty_id,verification_status,last_confirmed_at,source_metadata)
      SELECT f.id,s.id,'yes',now()-interval '30 days','{"benchmark":true}'::jsonb FROM facilities f CROSS JOIN specialties s
      WHERE f.source_metadata->>'benchmark'='true' AND s.normalized_name='benchmark oncology';
    INSERT INTO facility_diagnosis_capabilities (facility_id,diagnosis_id,status,last_verified_at,source_metadata)
      SELECT f.id,d.id,CASE WHEN row_number() over() % 3=0 THEN 'no'::verification_answer ELSE 'yes'::verification_answer END,
        now()-interval '20 days','{"benchmark":true}'::jsonb FROM facilities f CROSS JOIN diagnoses d
      WHERE f.source_metadata->>'benchmark'='true' AND d.code='Z99.0';
    INSERT INTO facility_verification_events (facility_id,verified_at,method,confidence,accepting_status,source_metadata)
      SELECT f.id,now()-(h || ' days')::interval,'phone','direct',f.current_accepting_status,'{"benchmark":true}'::jsonb
      FROM facilities f CROSS JOIN generate_series(1,10) h WHERE f.source_metadata->>'benchmark'='true';
    INSERT INTO facility_contact_attempts (facility_id,attempted_at,method,outcome)
      SELECT f.id,now()-interval '2 days','phone','no_answer'
      FROM facilities f WHERE f.source_metadata->>'benchmark'='true' AND right(f.normalized_name,1) IN ('1','3','5','7','9');
  `);
  const timings = await Promise.all([
    explain('facility directory', `SELECT id FROM facilities WHERE active AND normalized_name ILIKE $1 ORDER BY normalized_name LIMIT 25`, ['benchmark%'], 150),
    explain('50-mile radius search', `SELECT f.id, ST_Distance(f.geog_point::geography,o.geog_point::geography) FROM facilities f CROSS JOIN postal_code_centroids o WHERE o.zip_code='04103' AND f.active AND ST_DWithin(f.geog_point::geography,o.geog_point::geography,$1) ORDER BY 2 LIMIT 25`, [50 * 1609.344], 250),
    explain('reverification queue', `SELECT id FROM facilities WHERE active AND (accepting_verified_at IS NULL OR accepting_verified_at < now()-interval '45 days') ORDER BY accepting_verified_at NULLS FIRST LIMIT 25`, [], 200),
    explain('facility detail history', `SELECT * FROM facility_verification_events WHERE facility_id=$1 ORDER BY verified_at DESC LIMIT 100`, [(await client.query<{ id: string }>(`SELECT id FROM facilities WHERE source_metadata->>'benchmark'='true' LIMIT 1`)).rows[0]?.id], 100),
    explain('historical report', `SELECT verified_at::date,count(*) FROM facility_verification_events WHERE verified_at >= now()-interval '90 days' GROUP BY verified_at::date ORDER BY 1`, [], 300),
    explain('duplicate candidate block', `SELECT a.id,b.id FROM facilities a JOIN facilities b ON a.id<b.id AND a.phone_normalized=b.phone_normalized WHERE a.active AND b.active LIMIT 100`, [], 500),
  ]);
  console.table(timings);
  if (timings.some((timing) => !timing.pass)) process.exitCode = 1;
  await client.query('ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
