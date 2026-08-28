import { performance } from 'node:perf_hooks';
import { legacyStateDistribution, reconcilePreviewRows } from '../src/lib/import/migration-reconciliation';
import { buildImportPlan } from '../src/lib/import/reconcile';
import type { CallCandidate, ParsedWorkbook, StagedRow } from '../src/lib/import/types';

const sizes = (process.env.MIGRATION_PERFORMANCE_SIZES ?? '1000,10000,50000')
  .split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0);
const limits = new Map([[1_000, 5_000], [10_000, 15_000], [50_000, 60_000]]);

function source(rowNumber: number) {
  return { workbookKind: 'user' as const, sourceFileName: 'synthetic-user.xlsx', sourceHash: 'synthetic-performance', sheetName: 'Weekly Call Log', rowNumber };
}

function call(index: number): CallCandidate {
  const row = index + 2;
  return {
    source: source(row), fingerprint: `call-${index}`, logicalFingerprint: `logical-${index}`,
    callAt: new Date(Date.UTC(2025, 0, 1, 8, index % 60, 0)).toISOString(), callerInitials: 'PT',
    lob: 'COMMERCIAL', authorizationNumber: `AUTH-${index}`, facilityDisplayKey: 'Performance Clinic | Portland',
    normalizedFacilityKey: 'performance clinic|portland', specialty: 'Cardiology', normalizedSpecialty: 'cardiology',
    diagnosisCode: `D${index % 100}`, diagnosisDescription: 'Synthetic diagnosis', phone: '2075550100', didNotLeaveVm: false,
    acceptingNewPatients: index % 3 === 0 ? 'unknown' : index % 2 === 0 ? 'yes' : 'no',
    canTreatDiagnosis: 'yes', canScheduleWithinFourWeeks: 'yes', notes: null,
    specialtyConfirmed: 'yes',
    weekStart: '2024-12-29', duplicateGroupKey: `weekly-${index}`,
    resultCode: 'meets_availability_guidelines', resultPhrase: 'Meets availability guidelines',
    importedResultPhrase: null,
    legacyAnswers: { accepting: index % 3 === 0 ? 'unknown' : index % 2 === 0 ? 'yes' : 'no', diagnosis: 'yes', scheduling: 'yes', specialty: 'yes' },
    issues: [],
  };
}

function staged(item: CallCandidate): StagedRow {
  return { entityType: 'call', source: item.source, fingerprint: item.fingerprint, status: 'staged', rawData: {}, normalizedData: { accepting: item.acceptingNewPatients }, issues: item.issues };
}

function workbook(size: number): ParsedWorkbook {
  const calls = Array.from({ length: size }, (_, index) => call(index));
  return {
    source: {
      workbookKind: 'user', sourcePath: '[synthetic]', sourceFileName: 'synthetic-user.xlsx', sourceHash: 'synthetic-performance',
      sizeBytes: size * 250, importerVersion: 'performance-v1', sheetsSeen: ['Facilities', 'Facility-Specialty Map', 'Weekly Call Log', 'Zip Coordinates'],
      dateSystem: '1900', schemaVersion: 'provider-workbook-v2', sheetDetails: [], formulaCells: 0, hiddenRows: 0,
    },
    counts: { rowsVisited: size + 4, scaffoldRowsSkipped: 0, rejectedRows: 0, facilities: 0, facilitySpecialties: 0, calls: size, postalCodes: 0 },
    facilities: [], facilitySpecialties: [], calls, postalCodes: [], stagedRows: calls.map(staged), issues: [],
  };
}

const results = [];
for (const size of sizes) {
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const plan = buildImportPlan([workbook(size)]);
  const reconciliation = reconcilePreviewRows(plan);
  const distribution = legacyStateDistribution(plan);
  const durationMs = Math.round(performance.now() - started);
  const heapGrowthMb = Number(((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024).toFixed(1));
  const limitMs = limits.get(size) ?? Math.max(60_000, size * 1.2);
  const pass = plan.calls.length === size && reconciliation.reconciledRows === size
    && Object.values(distribution).reduce((sum, value) => sum + value, 0) === size * 4
    && durationMs <= limitMs && heapGrowthMb < 512;
  results.push({ rows: size, durationMs, limitMs, heapGrowthMb, pass });
}

console.table(results);
if (results.some((result) => !result.pass)) throw new Error('Migration performance limit failed.');
process.stdout.write(`${results.length}/${results.length} migration performance sizes passed.\n`);
