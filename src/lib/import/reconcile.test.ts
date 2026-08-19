import { describe, expect, it } from 'vitest';
import { buildImportPlan, safeImportSummary } from './reconcile';
import type { FacilityCandidate, ParsedWorkbook, WorkbookKind } from './types';

function parsedWorkbook(kind: WorkbookKind, facilities: FacilityCandidate[]): ParsedWorkbook {
  return {
    source: {
      workbookKind: kind,
      sourcePath: `C:/sensitive/${kind}.xlsx`,
      sourceFileName: `${kind}.xlsx`,
      sourceHash: `${kind}-hash`,
      sizeBytes: 100,
      importerVersion: 'test-v1',
      sheetsSeen: ['Facilities'],
      dateSystem: '1900',
    },
    counts: {
      rowsVisited: facilities.length,
      scaffoldRowsSkipped: 0,
      rejectedRows: 0,
      facilities: facilities.length,
      facilitySpecialties: 0,
      calls: 0,
      postalCodes: 0,
    },
    facilities,
    facilitySpecialties: [],
    calls: [],
    postalCodes: [],
    stagedRows: [],
    issues: [],
  };
}

function facility(kind: WorkbookKind, phoneRaw: string | null): FacilityCandidate {
  return {
    source: {
      workbookKind: kind,
      sourceFileName: `${kind}.xlsx`,
      sourceHash: `${kind}-hash`,
      sheetName: 'Facilities',
      rowNumber: 2,
    },
    fingerprint: 'same-fingerprint',
    facilityName: kind === 'admin' ? 'Canonical Facility' : 'User Facility Name',
    city: 'Augusta',
    normalizedName: 'canonical facility',
    normalizedCity: 'augusta',
    normalizedKey: 'canonical facility|augusta',
    displayKey: 'Canonical Facility | Augusta',
    facilityType: 'Hospital',
    autoFillSpecialty: false,
    phoneRaw,
    phoneNormalized: phoneRaw?.replace(/\D/g, '') ?? null,
    postalCode: '04330',
    latitude: null,
    longitude: null,
    issues: [],
  };
}

describe('workbook reconciliation', () => {
  it('uses admin master data as canonical and fills missing fields from user data', () => {
    const plan = buildImportPlan([
      parsedWorkbook('admin', [facility('admin', null)]),
      parsedWorkbook('user', [facility('user', '(207) 555-1212')]),
    ]);
    expect(plan.facilities).toHaveLength(1);
    expect(plan.facilities[0].facilityName).toBe('Canonical Facility');
    expect(plan.facilities[0].phoneRaw).toBe('(207) 555-1212');
  });

  it('redacts local source paths from shareable summaries', () => {
    const summary = safeImportSummary(buildImportPlan([parsedWorkbook('admin', [facility('admin', null)])]));
    expect(summary.sources[0].sourcePath).toBe('[redacted-local-path]');
    expect(JSON.stringify(summary)).not.toContain('C:/sensitive');
  });
});
