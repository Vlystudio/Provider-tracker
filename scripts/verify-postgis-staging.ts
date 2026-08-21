import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL is required.');
const database = new URL(connectionString).pathname.replace(/^\//, '');
const environment = process.env.TARGET_ENVIRONMENT?.trim();
if (environment !== 'staging' && environment !== 'test') {
  throw new Error('TARGET_ENVIRONMENT must be staging or test for the spatial staging gate.');
}
if (environment === 'staging' && process.env.CONFIRM_DATABASE !== database) {
  throw new Error(`Set CONFIRM_DATABASE=${database} to confirm the staging target.`);
}

const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
try {
  const extension = await pool.query<{ version: string }>(`SELECT extversion AS version FROM pg_extension WHERE extname='postgis'`);
  if (!extension.rows[0]) throw new Error('PostGIS extension is not enabled.');
  const columns = await pool.query<{ table_name: string; formatted_type: string }>(`
    SELECT c.relname AS table_name, format_type(a.atttypid,a.atttypmod) AS formatted_type
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND a.attname='geog_point' AND c.relname IN ('facilities','postal_code_centroids') AND NOT a.attisdropped`);
  if (columns.rows.length !== 2 || columns.rows.some((row) => !/geometry\(Point,4326\)/i.test(row.formatted_type))) {
    throw new Error(`Expected SRID 4326 point columns were not found: ${JSON.stringify(columns.rows)}`);
  }
  const indexes = await pool.query<{ indexname: string; indexdef: string }>(`
    SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'
      AND indexname IN ('facilities_geog_gist','facilities_geography_gist','postal_code_centroids_geog_gist') ORDER BY indexname`);
  const requiredIndexes = ['facilities_geog_gist', 'facilities_geography_gist', 'postal_code_centroids_geog_gist'];
  const missingIndexes = requiredIndexes.filter((name) => !indexes.rows.some((row) => row.indexname === name && /USING gist/i.test(row.indexdef)));
  if (missingIndexes.length) throw new Error(`Missing spatial indexes: ${missingIndexes.join(', ')}`);

  const behavior = await pool.query<{
    near_miles: number;
    far_miles: number;
    near_inside: boolean;
    far_inside: boolean;
    null_excluded: boolean;
  }>(`
    WITH origin AS (SELECT ST_SetSRID(ST_MakePoint(-70.29,43.68),4326)::geography AS point),
    samples AS (
      SELECT ST_Project(point, 9.9*1609.344, 0) AS near_point,
             ST_Project(point, 10.1*1609.344, 0) AS far_point,
             point AS origin_point FROM origin
    )
    SELECT
      round((ST_Distance(origin_point,near_point)/1609.344)::numeric,2)::float8 AS near_miles,
      round((ST_Distance(origin_point,far_point)/1609.344)::numeric,2)::float8 AS far_miles,
      ST_DWithin(origin_point,near_point,10*1609.344) AS near_inside,
      ST_DWithin(origin_point,far_point,10*1609.344) AS far_inside,
      NOT EXISTS (SELECT 1 FROM (VALUES (NULL::geography)) missing(point) WHERE ST_DWithin(origin_point,missing.point,10*1609.344)) AS null_excluded
    FROM samples`);
  const result = behavior.rows[0];
  if (!result?.near_inside || result.far_inside || !result.null_excluded || result.near_miles >= result.far_miles) {
    throw new Error(`Spatial behavior check failed: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    database,
    postgisVersion: extension.rows[0].version,
    columns: columns.rows,
    indexes: indexes.rows.map((row) => row.indexname),
    radiusBoundary: result,
    distanceUnits: 'miles converted to meters with 1609.344',
  }, null, 2)}\n`);
} finally {
  await pool.end();
}
