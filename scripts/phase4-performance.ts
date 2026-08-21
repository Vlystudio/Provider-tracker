import 'dotenv/config';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.endsWith('_test')) throw new Error('The performance fixture only runs against a database whose name ends in _test.');

const facilityCount = Number.parseInt(process.env.BENCHMARK_FACILITIES ?? '10000', 10);
const sampleCount = Number.parseInt(process.env.BENCHMARK_SAMPLES ?? '5', 10);
if (!Number.isInteger(facilityCount) || facilityCount < 10_000 || facilityCount > 100_000) {
  throw new Error('BENCHMARK_FACILITIES must be between 10000 and 100000.');
}
if (!Number.isInteger(sampleCount) || sampleCount < 3 || sampleCount > 10) {
  throw new Error('BENCHMARK_SAMPLES must be between 3 and 10.');
}

type JsonPlan = { 'Execution Time': number; Plan: PlanNode };
type PlanNode = { 'Node Type': string; 'Index Name'?: string; Plans?: PlanNode[] };
type BenchmarkCase = { name: string; statement: string; parameters: unknown[]; targetP95Ms: number };

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 120_000 });
const client = await pool.connect();

function percentile(values: number[], percentage: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)] ?? Number.NaN;
}

function indexNames(plan: PlanNode | undefined): string[] {
  if (!plan) return [];
  return [...new Set([...(plan['Index Name'] ? [plan['Index Name']] : []), ...(plan.Plans ?? []).flatMap(indexNames)])];
}

async function benchmark(item: BenchmarkCase) {
  const timings: number[] = [];
  let firstPlan: JsonPlan | undefined;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const result = await client.query<{ 'QUERY PLAN': JsonPlan[] }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${item.statement}`,
      item.parameters,
    );
    const plan = result.rows[0]?.['QUERY PLAN']?.[0];
    if (!plan) throw new Error(`No query plan returned for ${item.name}.`);
    firstPlan ??= plan;
    timings.push(plan['Execution Time']);
  }
  const result = await client.query(item.statement, item.parameters);
  const medianMs = percentile(timings, 0.5);
  const p95Ms = percentile(timings, 0.95);
  return {
    query: item.name,
    medianMs: Number(medianMs.toFixed(3)),
    p95Ms: Number(p95Ms.toFixed(3)),
    targetP95Ms: item.targetP95Ms,
    resultCount: result.rowCount ?? result.rows.length,
    rootPlan: firstPlan?.Plan['Node Type'] ?? 'unknown',
    indexes: indexNames(firstPlan?.Plan).join(', ') || 'none',
    pass: p95Ms <= item.targetP95Ms,
  };
}

const radiusQuery = (radiusMiles: number): BenchmarkCase => ({
  name: `${radiusMiles}-mile radius`,
  statement: `SELECT f.id, ST_Distance(f.geog_point::geography,o.geog_point::geography)/1609.344 AS miles
    FROM facilities f CROSS JOIN postal_code_centroids o
    WHERE o.zip_code='04103' AND f.active AND f.merged_into_facility_id IS NULL
      AND ST_DWithin(f.geog_point::geography,o.geog_point::geography,$1)
    ORDER BY miles,f.id LIMIT 100`,
  parameters: [radiusMiles * 1609.344],
  targetP95Ms: 1_500,
});

try {
  const postgis = await client.query<{ available: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='postgis') AS available`);
  if (!postgis.rows[0]?.available) throw new Error('PostGIS is not enabled in the performance-test database.');
  await client.query('BEGIN');
  await client.query('SET LOCAL statement_timeout = 120000');
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
      g || ' Test Street', 'ME', '207' || lpad(g::text,7,'0'), '207' || lpad(g::text,7,'0'), '04103',
      43.68 + (((g*37) % 240)-120)*0.01, -70.29 + (((g*53) % 240)-120)*0.012,
      ST_SetSRID(ST_MakePoint(-70.29 + (((g*53) % 240)-120)*0.012,43.68 + (((g*37) % 240)-120)*0.01),4326),
      'address', CASE WHEN g % 4=0 THEN 'no'::verification_answer ELSE 'yes'::verification_answer END,
      CASE WHEN g % 5=0 THEN 'no'::verification_answer ELSE 'yes'::verification_answer END,
      now()-((g%180)||' days')::interval, now()-((g%180)||' days')::interval,
      now()-((g%180)||' days')::interval, jsonb_build_object('benchmark',true)
    FROM generate_series(1,$1::int) g;
    INSERT INTO facility_specialties (facility_id,specialty_id,verification_status,last_confirmed_at,source_metadata)
      SELECT f.id,s.id,'yes',now()-((row_number() over())%240||' days')::interval,'{"benchmark":true}'::jsonb
      FROM facilities f CROSS JOIN specialties s
      WHERE f.source_metadata->>'benchmark'='true' AND s.normalized_name='benchmark oncology';
    INSERT INTO facility_diagnosis_capabilities (facility_id,diagnosis_id,status,last_verified_at,source_metadata)
      SELECT f.id,d.id,CASE WHEN row_number() over()%3=0 THEN 'no'::verification_answer ELSE 'yes'::verification_answer END,
        now()-interval '20 days','{"benchmark":true}'::jsonb FROM facilities f CROSS JOIN diagnoses d
      WHERE f.source_metadata->>'benchmark'='true' AND d.code='Z99.0';
    INSERT INTO facility_verification_events (facility_id,verified_at,method,confidence,accepting_status,source_metadata)
      SELECT f.id,now()-(h||' days')::interval,'phone','direct',f.current_accepting_status,'{"benchmark":true}'::jsonb
      FROM facilities f CROSS JOIN generate_series(1,10) h WHERE f.source_metadata->>'benchmark'='true';
  `, [facilityCount]);
  await client.query('ANALYZE facilities; ANALYZE facility_specialties; ANALYZE facility_diagnosis_capabilities; ANALYZE facility_verification_events;');

  const sharedOrigin = `CROSS JOIN postal_code_centroids o`;
  const sharedWhere = `o.zip_code='04103' AND f.active AND f.merged_into_facility_id IS NULL AND ST_DWithin(f.geog_point::geography,o.geog_point::geography,$1)`;
  const cases: BenchmarkCase[] = [
    radiusQuery(10), radiusQuery(25), radiusQuery(50), radiusQuery(100),
    {
      name: 'specialty + radius',
      statement: `SELECT f.id FROM facilities f ${sharedOrigin} JOIN facility_specialties fs ON fs.facility_id=f.id AND fs.active JOIN specialties s ON s.id=fs.specialty_id WHERE ${sharedWhere} AND s.normalized_name=$2 ORDER BY ST_Distance(f.geog_point::geography,o.geog_point::geography),f.id LIMIT 100`,
      parameters: [50*1609.344,'benchmark oncology'], targetP95Ms: 1_500,
    },
    {
      name: 'diagnosis + radius',
      statement: `SELECT f.id FROM facilities f ${sharedOrigin} JOIN facility_diagnosis_capabilities fd ON fd.facility_id=f.id AND fd.active JOIN diagnoses d ON d.id=fd.diagnosis_id WHERE ${sharedWhere} AND d.code=$2 AND fd.status='yes' ORDER BY ST_Distance(f.geog_point::geography,o.geog_point::geography),f.id LIMIT 100`,
      parameters: [50*1609.344,'Z99.0'], targetP95Ms: 1_500,
    },
    {
      name: 'accepting + radius',
      statement: `SELECT f.id FROM facilities f ${sharedOrigin} WHERE ${sharedWhere} AND f.current_accepting_status='yes' ORDER BY ST_Distance(f.geog_point::geography,o.geog_point::geography),f.id LIMIT 100`,
      parameters: [50*1609.344], targetP95Ms: 1_500,
    },
    {
      name: 'freshness + radius',
      statement: `SELECT f.id FROM facilities f ${sharedOrigin} WHERE ${sharedWhere} AND f.accepting_verified_at>=now()-interval '45 days' ORDER BY ST_Distance(f.geog_point::geography,o.geog_point::geography),f.id LIMIT 100`,
      parameters: [50*1609.344], targetP95Ms: 1_500,
    },
    {
      name: 'recommended ranking + radius',
      statement: `SELECT f.id,(CASE WHEN f.current_accepting_status='yes' THEN 20 ELSE 0 END + CASE WHEN f.accepting_verified_at>=now()-interval '30 days' THEN 12 ELSE -8 END + GREATEST(0,12-ST_Distance(f.geog_point::geography,o.geog_point::geography)/1609.344/10.0)) AS score FROM facilities f ${sharedOrigin} WHERE ${sharedWhere} ORDER BY score DESC,ST_Distance(f.geog_point::geography,o.geog_point::geography),f.id LIMIT 100`,
      parameters: [100*1609.344], targetP95Ms: 1_500,
    },
  ];
  const results = [];
  for (const item of cases) results.push(await benchmark(item));
  console.table(results);
  process.stdout.write(`${JSON.stringify({ status: results.every((result) => result.pass) ? 'PASS' : 'FAIL', facilityCount, verificationEventCount: facilityCount*10, samplesPerQuery: sampleCount, results }, null, 2)}\n`);
  if (results.some((result) => !result.pass)) process.exitCode = 1;
  await client.query('ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
