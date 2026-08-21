import { describe, expect, it } from 'vitest';
import { migrationReadiness, reconcilePreviewRows } from './migration-reconciliation';
import type { ImportPlan, StagedRow } from './types';

function plan(rows: StagedRow[]): ImportPlan {
  return {
    importerVersion: 'test', generatedAt: new Date(0).toISOString(), sources: [], facilities: [],
    facilitySpecialties: [], calls: [], postalCodes: [], stagedRows: rows, issues: [],
    counts: {
      rowsVisited: rows.length, scaffoldRowsSkipped: 0, rejectedRows: 0, facilities: 0,
      facilitySpecialties: 0, calls: 0, postalCodes: 0, sourceFiles: 1, uniqueFacilities: 0,
      uniqueFacilitySpecialties: 0, uniqueCalls: 0, uniquePostalCodes: 0, exactDuplicateCalls: 0,
      possibleCrossWorkbookCallDuplicates: 0, unresolvedFacilityReferences: 0,
      issueWarnings: 0, issueErrors: 0,
    },
  };
}

function row(status: StagedRow['status'], issues: string[] = []): StagedRow {
  return {
    entityType: 'facility', fingerprint: `${status}-${issues.join('-')}`,
    source: { workbookKind: 'admin', sourceFileName: 'source.xlsx', sourceHash: 'hash', sheetName: 'Facilities', rowNumber: 2 },
    status, rawData: {}, normalizedData: {}, issues,
  };
}

describe('migration reconciliation', () => {
  it('assigns every staged row to one reconciliation state', () => {
    const result = reconcilePreviewRows(plan([
      row('staged'), row('duplicate'), row('skipped'), row('rejected'),
      row('staged', ['call_facility_not_in_master']),
    ]));
    expect(result).toMatchObject({ sourceRows: 5, reconciledRows: 5, importedRows: 1, unchangedRows: 1, skippedRows: 1, invalidRows: 1, conflictRows: 1, reconciliationPercent: 100 });
    expect(migrationReadiness(plan([row('staged', ['call_facility_not_in_master'])]))).toBe('no_go');
  });

  it('treats an empty, fully accounted preview as ready', () => {
    expect(migrationReadiness(plan([]))).toBe('go');
  });
});
