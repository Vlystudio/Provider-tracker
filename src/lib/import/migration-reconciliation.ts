import type { ImportPlan, LegacySemanticStatus, StagedRow } from './types';

export type MigrationReadiness = 'go' | 'go_with_warnings' | 'no_go';

export type ReconciliationCounts = {
  sourceRows: number;
  reconciledRows: number;
  importedRows: number;
  updatedRows: number;
  unchangedRows: number;
  skippedRows: number;
  conflictRows: number;
  invalidRows: number;
  reconciliationPercent: number;
};

const conflictCodes = new Set([
  'call_facility_not_in_master',
  'mapping_facility_not_in_master',
  'facility_match_ambiguous',
  'specialty_mapping_required',
]);

function rowState(row: StagedRow): keyof Pick<
  ReconciliationCounts,
  'importedRows' | 'unchangedRows' | 'skippedRows' | 'conflictRows' | 'invalidRows'
> {
  if (row.status === 'rejected') return 'invalidRows';
  if (row.issues.some((issue) => conflictCodes.has(issue))) return 'conflictRows';
  if (row.status === 'skipped') return 'skippedRows';
  if (row.status === 'duplicate') return 'unchangedRows';
  return 'importedRows';
}

export function reconcilePreviewRows(plan: ImportPlan): ReconciliationCounts {
  const result: ReconciliationCounts = {
    sourceRows: plan.stagedRows.length,
    reconciledRows: 0,
    importedRows: 0,
    updatedRows: 0,
    unchangedRows: 0,
    skippedRows: 0,
    conflictRows: 0,
    invalidRows: 0,
    reconciliationPercent: 0,
  };
  for (const row of plan.stagedRows) result[rowState(row)] += 1;
  result.reconciledRows = result.importedRows + result.updatedRows + result.unchangedRows
    + result.skippedRows + result.conflictRows + result.invalidRows;
  result.reconciliationPercent = result.sourceRows === 0
    ? 100
    : Number(((result.reconciledRows / result.sourceRows) * 100).toFixed(4));
  return result;
}

export function migrationReadiness(
  plan: ImportPlan,
  reconciliation = reconcilePreviewRows(plan),
): MigrationReadiness {
  const blockers = plan.issues.some((issue) => issue.severity === 'error')
    || reconciliation.invalidRows > 0
    || reconciliation.conflictRows > 0;
  if (blockers || reconciliation.reconciledRows !== reconciliation.sourceRows) return 'no_go';
  const warnings = plan.issues.some((issue) => issue.severity === 'warning')
    || plan.sources.some((source) => source.formulaCells > 0 || source.hiddenRows > 0);
  return warnings ? 'go_with_warnings' : 'go';
}

export function legacyStateDistribution(plan: ImportPlan): Record<LegacySemanticStatus, number> {
  const result: Record<LegacySemanticStatus, number> = {
    yes: 0,
    no: 0,
    unknown: 0,
    blank: 0,
    not_asked: 0,
    unable_to_verify: 0,
    not_applicable: 0,
  };
  for (const call of plan.calls) {
    for (const value of Object.values(call.legacyAnswers)) result[value] += 1;
  }
  return result;
}

export function sourceReportComparison(plan: ImportPlan) {
  const accepting = { yes: 0, no: 0, unknown: 0, notApplicable: 0 };
  for (const call of plan.calls) {
    if (call.acceptingNewPatients === 'yes') accepting.yes += 1;
    else if (call.acceptingNewPatients === 'no') accepting.no += 1;
    else if (call.acceptingNewPatients === 'not_applicable') accepting.notApplicable += 1;
    else accepting.unknown += 1;
  }
  return {
    calls: plan.calls.length,
    accepting,
    acceptingRateDenominator: accepting.yes + accepting.no,
  };
}
