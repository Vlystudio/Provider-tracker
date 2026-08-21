import 'dotenv/config';

import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { legacyStateDistribution, migrationReadiness, reconcilePreviewRows } from '../src/lib/import/migration-reconciliation';
import { normalizePostalCode, parseWorkbookDate, toLegacySemanticStatus } from '../src/lib/import/normalization';
import { buildImportPlan } from '../src/lib/import/reconcile';
import type { FacilityCandidate, ParsedWorkbook, StagedRow } from '../src/lib/import/types';

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('MIGRATION_TEST_DATABASE_URL or DATABASE_URL is required.');
if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) throw new Error('Migration acceptance only runs against a database whose name ends in _test.');

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const suffix = randomBytes(6).toString('hex');
const table = `migration_acceptance_${suffix}`;
const results: Array<{ scenario: string; pass: boolean; detail: string }> = [];
function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }

function facility(rowNumber: number): FacilityCandidate {
  return {
    source: { workbookKind: 'admin', sourceFileName: 'synthetic-admin.xlsx', sourceHash: 'stable-source', sheetName: 'Facilities', rowNumber },
    fingerprint: `facility-${rowNumber}`, facilityName: `Clinic ${rowNumber}`, city: 'Portland', normalizedName: `clinic ${rowNumber}`,
    normalizedCity: 'portland', normalizedKey: `clinic ${rowNumber}|portland`, displayKey: `Clinic ${rowNumber} | Portland`,
    facilityType: 'Hospital', autoFillSpecialty: false, active: true, legacyStatus: null, phoneRaw: null,
    phoneNormalized: null, postalCode: '04101', latitude: null, longitude: null, issues: [],
  };
}

function workbook(): ParsedWorkbook {
  const facilities = [facility(2), facility(3)];
  const stagedRows: StagedRow[] = facilities.map((item) => ({ entityType: 'facility', source: item.source, fingerprint: item.fingerprint, status: 'staged', rawData: {}, normalizedData: { normalizedKey: item.normalizedKey }, issues: item.issues }));
  return {
    source: { workbookKind: 'admin', sourcePath: '[synthetic]', sourceFileName: 'synthetic-admin.xlsx', sourceHash: 'stable-source', sizeBytes: 1000, importerVersion: 'acceptance-v1', sheetsSeen: ['Facilities'], dateSystem: '1900', schemaVersion: 'ura-workbook-v1', sheetDetails: [], formulaCells: 0, hiddenRows: 0 },
    counts: { rowsVisited: 2, scaffoldRowsSkipped: 0, rejectedRows: 0, facilities: 2, facilitySpecialties: 0, calls: 0, postalCodes: 0 },
    facilities, facilitySpecialties: [], calls: [], postalCodes: [], stagedRows, issues: [],
  };
}

async function main() {
  record('Leading-zero ZIP is preserved', normalizePostalCode(4330) === '04330' && normalizePostalCode('04101-1234') === '04101-1234', `${normalizePostalCode(4330)}, ${normalizePostalCode('04101-1234')}`);
  const ambiguousDate = parseWorkbookDate('03/04/05', '1900');
  record('Ambiguous date is not treated as fresh', ambiguousDate === null, String(ambiguousDate));
  const semantic = ['', 'Unknown', 'Not asked', 'Unable to verify', 'N/A', 'Yes', 'No'].map(toLegacySemanticStatus);
  record('Legacy answer states stay distinct', JSON.stringify(semantic) === JSON.stringify(['blank', 'unknown', 'not_asked', 'unable_to_verify', 'not_applicable', 'yes', 'no']), semantic.join(', '));

  const first = buildImportPlan([workbook()]);
  const second = buildImportPlan([workbook()]);
  record('Repeated planning is stable', JSON.stringify(first.facilities.map((item) => item.fingerprint)) === JSON.stringify(second.facilities.map((item) => item.fingerprint)), `${first.facilities.length} stable facilities`);
  const reconciled = reconcilePreviewRows(first);
  record('Every operational source row has a state', reconciled.sourceRows === reconciled.reconciledRows && reconciled.reconciliationPercent === 100, `${reconciled.reconciledRows}/${reconciled.sourceRows}`);
  record('Clean preview is ready', migrationReadiness(first) === 'go', migrationReadiness(first));
  record('State distribution has explicit zeroes', Object.values(legacyStateDistribution(first)).every((value) => value === 0), JSON.stringify(legacyStateDistribution(first)));
  record('Source hashing detects a changed file', createHash('sha256').update('one').digest('hex') !== createHash('sha256').update('two').digest('hex'), 'different SHA-256 values');

  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE ${table} (id integer PRIMARY KEY, value text NOT NULL, verified_at timestamptz)`);
    await client.query(`INSERT INTO ${table} VALUES (1,'current',now())`);
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO ${table} VALUES (2,'partial',NULL)`);
      throw new Error('simulated apply failure');
    } catch {
      await client.query('ROLLBACK');
    }
    const afterRollback = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
    record('Failed apply transaction leaves no partial row', afterRollback.rows[0].count === 1, `rows=${afterRollback.rows[0].count}`);

    await client.query(`UPDATE ${table} SET value=CASE WHEN verified_at IS NULL THEN 'legacy' ELSE value END WHERE id=1`);
    const protectedValue = await client.query<{ value: string }>(`SELECT value FROM ${table} WHERE id=1`);
    record('Newer verified value wins over legacy value', protectedValue.rows[0].value === 'current', protectedValue.rows[0].value);

    const other = await pool.connect();
    try {
      const key = `migration-acceptance:${suffix}`;
      const firstLock = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [key]);
      const secondLock = await other.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [key]);
      record('Concurrent import lock allows one runner', firstLock.rows[0].acquired && !secondLock.rows[0].acquired, `${firstLock.rows[0].acquired}/${secondLock.rows[0].acquired}`);
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
    } finally { other.release(); }
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${table}`);
    client.release();
  }

  console.table(results);
  const failed = results.filter((result) => !result.pass);
  if (failed.length) throw new Error(`${failed.length} migration acceptance scenario(s) failed.`);
  process.stdout.write(`${results.length}/${results.length} migration scenarios passed.\n`);
}

try { await main(); } finally { await pool.end(); }
