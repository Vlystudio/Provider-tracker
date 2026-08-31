import type {
  CallCandidate,
  FacilityCandidate,
  FacilitySpecialtyCandidate,
  ImportIssue,
  ImportPlan,
  ParsedWorkbook,
  PostalCodeCandidate,
  SafeImportSummary,
  SourceRef,
} from './types';

function sourcePriority(source: SourceRef) {
  if (source.workbookKind === 'admin' && source.sheetName === 'tblWeeklyCallLog') return 500;
  if (source.workbookKind === 'admin' && source.sheetName === 'Facilities') return 450;
  if (source.workbookKind === 'admin' && source.sheetName === 'Facility-Specialty Map') return 450;
  if (source.workbookKind === 'user' && source.sheetName === 'Weekly Call Log') return 400;
  if (source.workbookKind === 'admin' && source.sheetName === 'Monthly Archive') return 350;
  if (source.workbookKind === 'admin') return 300;
  return 200;
}

function preferSource<T extends { source: SourceRef }>(current: T, incoming: T) {
  return sourcePriority(incoming.source) > sourcePriority(current.source) ? incoming : current;
}

function mergeFacility(current: FacilityCandidate, incoming: FacilityCandidate) {
  const preferred = preferSource(current, incoming);
  const fallback = preferred === current ? incoming : current;
  return {
    ...preferred,
    phoneRaw: preferred.phoneRaw ?? fallback.phoneRaw,
    phoneNormalized: preferred.phoneNormalized ?? fallback.phoneNormalized,
    postalCode: preferred.postalCode ?? fallback.postalCode,
    latitude: preferred.latitude ?? fallback.latitude,
    longitude: preferred.longitude ?? fallback.longitude,
    issues: [...new Set([...preferred.issues, ...fallback.issues])],
  };
}

function deduplicateByFingerprint<T extends { fingerprint: string; source: SourceRef }>(
  values: T[],
  merge: (current: T, incoming: T) => T = preferSource,
) {
  const byFingerprint = new Map<string, T>();
  for (const value of values) {
    const current = byFingerprint.get(value.fingerprint);
    byFingerprint.set(value.fingerprint, current ? merge(current, value) : value);
  }
  return [...byFingerprint.values()];
}

function addReconciliationIssue(
  issues: ImportIssue[],
  source: SourceRef,
  code: string,
  message: string,
  severity: 'warning' | 'error' = 'warning',
) {
  issues.push({ code, severity, source, message });
}

export function buildImportPlan(parsedWorkbooks: ParsedWorkbook[]): ImportPlan {
  if (!parsedWorkbooks.length) throw new Error('At least one parsed workbook is required.');
  const importerVersions = new Set(parsedWorkbooks.map((workbook) => workbook.source.importerVersion));
  if (importerVersions.size !== 1) throw new Error('All source workbooks must use the same importer version.');

  const issues = parsedWorkbooks.flatMap((workbook) => workbook.issues);
  const rawFacilities = parsedWorkbooks.flatMap((workbook) => workbook.facilities);
  const rawMappings = parsedWorkbooks.flatMap((workbook) => workbook.facilitySpecialties);
  const rawCalls = parsedWorkbooks.flatMap((workbook) => workbook.calls);
  const rawPostalCodes = parsedWorkbooks.flatMap((workbook) => workbook.postalCodes);

  const facilities = deduplicateByFingerprint(rawFacilities, mergeFacility).sort((a, b) =>
    a.normalizedKey.localeCompare(b.normalizedKey),
  );
  const facilitySpecialties = deduplicateByFingerprint<FacilitySpecialtyCandidate>(rawMappings).sort((a, b) =>
    a.fingerprint.localeCompare(b.fingerprint),
  );
  const postalCodes = deduplicateByFingerprint<PostalCodeCandidate>(rawPostalCodes).sort((a, b) =>
    a.zipCode.localeCompare(b.zipCode),
  );

  const callsByFingerprint = new Map<string, CallCandidate>();
  let exactDuplicateCalls = 0;
  for (const call of rawCalls) {
    const current = callsByFingerprint.get(call.fingerprint);
    if (current) {
      exactDuplicateCalls += 1;
      callsByFingerprint.set(call.fingerprint, preferSource(current, call));
    } else {
      callsByFingerprint.set(call.fingerprint, call);
    }
  }
  const calls = [...callsByFingerprint.values()].sort((a, b) =>
    a.callAt === b.callAt ? a.fingerprint.localeCompare(b.fingerprint) : a.callAt.localeCompare(b.callAt),
  );

  const logicalGroups = new Map<string, CallCandidate[]>();
  for (const call of calls) {
    const group = logicalGroups.get(call.logicalFingerprint) ?? [];
    group.push(call);
    logicalGroups.set(call.logicalFingerprint, group);
  }
  let possibleCrossWorkbookCallDuplicates = 0;
  for (const group of logicalGroups.values()) {
    const workbookKinds = new Set(group.map((call) => call.source.workbookKind));
    if (group.length > 1 && workbookKinds.size > 1) {
      possibleCrossWorkbookCallDuplicates += group.length - 1;
      for (const call of group) {
        if (!call.issues.includes('possible_cross_workbook_duplicate')) {
          call.issues.push('possible_cross_workbook_duplicate');
          addReconciliationIssue(
            issues,
            call.source,
            'possible_cross_workbook_duplicate',
            'Call has the same caller/date/facility/specialty/diagnosis as a row in the other workbook but a different timestamp.',
          );
        }
      }
    }
  }

  const facilityKeys = new Set(facilities.map((facility) => facility.normalizedKey));
  let unresolvedFacilityReferences = 0;
  for (const call of calls) {
    if (!facilityKeys.has(call.normalizedFacilityKey)) {
      unresolvedFacilityReferences += 1;
      call.issues.push('call_facility_not_in_master');
      addReconciliationIssue(
        issues,
        call.source,
        'call_facility_not_in_master',
        'Call references a facility not found in either facility master and requires review.',
      );
    }
  }
  for (const mapping of facilitySpecialties) {
    if (!facilityKeys.has(mapping.normalizedFacilityKey)) {
      mapping.issues.push('mapping_facility_not_in_master');
      addReconciliationIssue(
        issues,
        mapping.source,
        'mapping_facility_not_in_master',
        'Facility-specialty mapping references a facility not found in either facility master.',
      );
    }
  }

  const aggregate = parsedWorkbooks.reduce(
    (counts, workbook) => ({
      rowsVisited: counts.rowsVisited + workbook.counts.rowsVisited,
      scaffoldRowsSkipped: counts.scaffoldRowsSkipped + workbook.counts.scaffoldRowsSkipped,
      rejectedRows: counts.rejectedRows + workbook.counts.rejectedRows,
      facilities: counts.facilities + workbook.counts.facilities,
      facilitySpecialties: counts.facilitySpecialties + workbook.counts.facilitySpecialties,
      calls: counts.calls + workbook.counts.calls,
      postalCodes: counts.postalCodes + workbook.counts.postalCodes,
    }),
    {
      rowsVisited: 0,
      scaffoldRowsSkipped: 0,
      rejectedRows: 0,
      facilities: 0,
      facilitySpecialties: 0,
      calls: 0,
      postalCodes: 0,
    },
  );

  return {
    importerVersion: [...importerVersions][0],
    generatedAt: new Date().toISOString(),
    sources: parsedWorkbooks.map((workbook) => workbook.source),
    counts: {
      ...aggregate,
      sourceFiles: parsedWorkbooks.length,
      uniqueFacilities: facilities.length,
      uniqueFacilitySpecialties: facilitySpecialties.length,
      uniqueCalls: calls.length,
      uniquePostalCodes: postalCodes.length,
      exactDuplicateCalls,
      possibleCrossWorkbookCallDuplicates,
      unresolvedFacilityReferences,
      issueWarnings: issues.filter((issue) => issue.severity === 'warning').length,
      issueErrors: issues.filter((issue) => issue.severity === 'error').length,
    },
    facilities,
    facilitySpecialties,
    calls,
    postalCodes,
    stagedRows: parsedWorkbooks.flatMap((workbook) => workbook.stagedRows),
    issues,
  };
}

export function safeImportSummary(plan: ImportPlan, maxIssueSamples = 25): SafeImportSummary {
  const issueCounts: SafeImportSummary['issueCounts'] = {};
  const sampleByCode = new Map<string, ImportIssue>();
  for (const issue of plan.issues) {
    issueCounts[issue.code] = {
      severity: issue.severity,
      count: (issueCounts[issue.code]?.count ?? 0) + 1,
    };
    if (!sampleByCode.has(issue.code)) sampleByCode.set(issue.code, issue);
  }
  return {
    importerVersion: plan.importerVersion,
    generatedAt: plan.generatedAt,
    sources: plan.sources.map((source) => ({ ...source, sourcePath: '[redacted-local-path]' as const })),
    counts: plan.counts,
    issueCounts,
    issueSamples: [...sampleByCode.values()].slice(0, maxIssueSamples).map((issue) => ({
      ...issue,
      source: {
        workbookKind: issue.source.workbookKind,
        sourceFileName: issue.source.sourceFileName,
        sheetName: issue.source.sheetName,
        rowNumber: issue.source.rowNumber,
      },
    })),
  };
}
