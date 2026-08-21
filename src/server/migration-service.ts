import 'server-only';

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  auditEvents,
  calls,
  diagnoses,
  facilities,
  importBatches,
  importRowResults,
  legacyValueMappings,
  migrationDiagnostics,
  migrationReconciliations,
  migrationRuns,
  migrationSources,
  specialties,
  users,
} from '@/db/schema';
import { normalizeKeyPart } from '@/lib/import/normalization';
import { migrationCsvCell } from '@/lib/import/csv';
import {
  legacyStateDistribution,
  migrationReadiness,
  reconcilePreviewRows,
  sourceReportComparison,
  type MigrationReadiness,
} from '@/lib/import/migration-reconciliation';
import { applyImportPlan, type ApplyImportOptions } from '@/lib/import/apply';
import { buildImportPlan, safeImportSummary } from '@/lib/import/reconcile';
import type { ImportIssue, ImportPlan, WorkbookKind } from '@/lib/import/types';
import { parseWorkbook } from '@/lib/import/workbook-parser';
import { getReleaseIdentifier } from './release';
import { getDatabasePool, requireDatabaseClient } from './database';
import type { Principal } from './authorization';
import { buildAuditEvent } from './audit';

const MAX_REQUEST_BYTES = 48 * 1024 * 1024;
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const safeFileName = /^[a-zA-Z0-9][a-zA-Z0-9 ._()-]{0,159}\.xlsx$/i;

export const migrationIdSchema = z.string().uuid();
export const applyMigrationSchema = z.object({
  reason: z.string().trim().min(8).max(500),
  simulateFailureAfterStaging: z.boolean().optional().default(false),
}).strict();
export const diagnosticResolutionSchema = z.object({
  action: z.enum(['use_existing', 'create_new', 'skip', 'defer']),
  targetEntityId: z.string().uuid().nullable().optional(),
  note: z.string().trim().min(3).max(500),
  version: z.number().int().nonnegative(),
}).strict();
export const reversalSchema = z.object({
  reason: z.string().trim().min(8).max(500),
  confirmRunId: z.string().uuid(),
  dryRun: z.boolean().default(true),
}).strict();

export class MigrationServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function validatedMigrationId(value: string) {
  const parsed = migrationIdSchema.safeParse(value);
  if (!parsed.success) throw new MigrationServiceError('Migration identifier is invalid.');
  return parsed.data;
}

type UploadedWorkbook = { kind: WorkbookKind; file: File };
type DiagnosticDraft = {
  sourceHash: string;
  workbookKind: WorkbookKind;
  entityType: string;
  sheetName: string;
  sourceRow: number;
  rowKey: string | null;
  issueCode: string;
  severity: 'warning' | 'error';
  message: string;
  suggestedAction: string;
};

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateUpload(file: File, kind: WorkbookKind) {
  if (!safeFileName.test(file.name) || path.extname(file.name).toLowerCase() !== '.xlsx') {
    throw new MigrationServiceError(`${kind} workbook must be a macro-free .xlsx file with a plain filename.`);
  }
  if (file.size < 1 || file.size > MAX_FILE_BYTES) {
    throw new MigrationServiceError(`${kind} workbook must be between 1 byte and ${MAX_FILE_BYTES} bytes.`, 413);
  }
}

export function enforceMigrationUploadSize(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
    throw new MigrationServiceError('Content-Type must be multipart/form-data.');
  }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
    throw new MigrationServiceError('Migration upload is too large.', 413);
  }
}

export async function readMigrationFormData(request: Request) {
  try {
    return await request.formData();
  } catch {
    throw new MigrationServiceError('Migration upload is not valid multipart form data.');
  }
}

export function workbooksFromFormData(form: FormData): UploadedWorkbook[] {
  const result: UploadedWorkbook[] = [];
  for (const kind of ['admin', 'user'] as const) {
    const value = form.get(kind);
    if (value instanceof File && value.size > 0) {
      validateUpload(value, kind);
      result.push({ kind, file: value });
    }
  }
  if (!result.length) throw new MigrationServiceError('Choose at least one workbook.');
  return result;
}

async function parseUploads(workbooks: UploadedWorkbook[]): Promise<ImportPlan> {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'provider-migration-'));
  try {
    const parsed = [];
    for (const workbook of workbooks) {
      const bytes = new Uint8Array(await workbook.file.arrayBuffer());
      if (bytes.byteLength !== workbook.file.size) throw new MigrationServiceError('Workbook upload was incomplete.');
      const filePath = path.join(workingDirectory, `${workbook.kind}-${sha256(bytes).slice(0, 16)}.xlsx`);
      await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
      parsed.push(await parseWorkbook(filePath, workbook.kind));
    }
    const plan = buildImportPlan(parsed);
    if (new Set(plan.sources.map((source) => source.sourceHash)).size !== plan.sources.length) {
      throw new MigrationServiceError('The admin and user uploads must be different workbook files.');
    }
    return plan;
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function issueEntity(issue: ImportIssue): string {
  if (issue.source.sheetName.includes('Call')) return 'call';
  if (issue.source.sheetName.includes('Specialty')) return 'facility_specialty';
  if (issue.source.sheetName.includes('Zip')) return 'postal_code';
  return 'facility';
}

function issueDraft(issue: ImportIssue): DiagnosticDraft {
  return {
    sourceHash: 'sourceHash' in issue.source ? String(issue.source.sourceHash) : '',
    workbookKind: issue.source.workbookKind,
    entityType: issueEntity(issue),
    sheetName: issue.source.sheetName,
    sourceRow: issue.source.rowNumber,
    rowKey: null,
    issueCode: issue.code,
    severity: issue.severity,
    message: issue.message,
    suggestedAction: issue.severity === 'error' ? 'Review before applying.' : 'Confirm during migration review.',
  };
}

function similarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeKeyPart(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeKeyPart(right).split(' ').filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / union.size;
}

async function buildDiagnostics(plan: ImportPlan): Promise<DiagnosticDraft[]> {
  const db = requireDatabaseClient();
  const [facilityRows, specialtyRows, diagnosisRows, currentUserRows, storedMappingRows] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.facilityName, city: facilities.city, normalizedName: facilities.normalizedName, normalizedCity: facilities.normalizedCity, phone: facilities.phoneNormalized, postalCode: facilities.postalCode }).from(facilities),
    db.select({ id: specialties.id, name: specialties.canonicalName, normalizedName: specialties.normalizedName, aliases: specialties.aliases }).from(specialties),
    db.select({ id: diagnoses.id, code: diagnoses.code, aliases: diagnoses.aliases }).from(diagnoses),
    db.select({ id: users.id, initials: users.initials }).from(users).where(eq(users.isActive, true)),
    db.select().from(legacyValueMappings),
  ]);
  const drafts: DiagnosticDraft[] = plan.issues.map((issue) => {
    const matchingSource = plan.sources.find((source) => source.workbookKind === issue.source.workbookKind);
    return { ...issueDraft(issue), sourceHash: matchingSource?.sourceHash ?? '' };
  });

  for (const source of plan.sources) {
    for (const sheet of source.sheetDetails) {
      if (sheet.hidden) drafts.push({ sourceHash: source.sourceHash, workbookKind: source.workbookKind, entityType: 'workbook', sheetName: sheet.name, sourceRow: 0, rowKey: sheet.name, issueCode: 'hidden_sheet_present', severity: 'warning', message: `The source sheet “${sheet.name}” is hidden.`, suggestedAction: 'Confirm that the hidden sheet belongs in the migration.' });
      if (sheet.hiddenRows) drafts.push({ sourceHash: source.sourceHash, workbookKind: source.workbookKind, entityType: 'workbook', sheetName: sheet.name, sourceRow: 0, rowKey: sheet.name, issueCode: 'hidden_rows_present', severity: 'warning', message: `${sheet.hiddenRows} hidden source row(s) will be included.`, suggestedAction: 'Confirm that hidden rows belong in the migration.' });
      if (sheet.formulaCells) drafts.push({ sourceHash: source.sourceHash, workbookKind: source.workbookKind, entityType: 'workbook', sheetName: sheet.name, sourceRow: 0, rowKey: sheet.name, issueCode: 'formula_values_present', severity: 'warning', message: `${sheet.formulaCells} formula cell(s) use their saved workbook values.`, suggestedAction: 'Recalculate and save the workbook before the final preview.' });
    }
  }

  const exactFacilities = new Set(facilityRows.map((row) => `${row.normalizedName}|${row.normalizedCity}`));
  for (const candidate of plan.facilities) {
    if (exactFacilities.has(candidate.normalizedKey)) continue;
    const possible = facilityRows.filter((row) => {
      const samePhone = Boolean(candidate.phoneNormalized && row.phone === candidate.phoneNormalized);
      const sameZip = Boolean(candidate.postalCode && row.postalCode?.slice(0, 5) === candidate.postalCode.slice(0, 5));
      return row.normalizedCity === candidate.normalizedCity && (samePhone || sameZip || similarity(row.name, candidate.facilityName) >= 0.55);
    }).map((row) => ({ ...row, score: similarity(row.name, candidate.facilityName) })).sort((a, b) => b.score - a.score);
    if (!possible.length) continue;
    const ambiguous = possible.length > 1 || possible[0].score < 0.8;
    drafts.push({
      sourceHash: candidate.source.sourceHash, workbookKind: candidate.source.workbookKind,
      entityType: 'facility', sheetName: candidate.source.sheetName, sourceRow: candidate.source.rowNumber,
      rowKey: candidate.normalizedKey,
      issueCode: ambiguous ? 'facility_match_ambiguous' : 'facility_match_high_confidence',
      severity: ambiguous ? 'error' : 'warning',
      message: ambiguous ? `${possible.length} existing facilities may match ${candidate.displayKey}.` : `${candidate.displayKey} is similar to an existing facility but will remain separate unless reviewed.`,
      suggestedAction: ambiguous ? 'Choose an existing facility or keep this as a new record.' : 'Review the suggested match before applying.',
    });
  }

  const specialtyKeys = new Set<string>();
  for (const row of specialtyRows) {
    specialtyKeys.add(row.normalizedName);
    for (const alias of row.aliases) specialtyKeys.add(normalizeKeyPart(alias));
  }
  const specialtyCandidates = new Map<string, { name: string; sourceHash: string; kind: WorkbookKind; sheet: string; row: number }>();
  for (const value of [...plan.facilitySpecialties, ...plan.calls]) {
    if (!value.normalizedSpecialty || !value.specialty || specialtyCandidates.has(value.normalizedSpecialty)) continue;
    specialtyCandidates.set(value.normalizedSpecialty, { name: value.specialty, sourceHash: value.source.sourceHash, kind: value.source.workbookKind, sheet: value.source.sheetName, row: value.source.rowNumber });
  }
  for (const [key, value] of specialtyCandidates) {
    const stored = storedMappingRows.find((mapping) => mapping.mappingType === 'specialty' && mapping.normalizedValue === key);
    if (!specialtyKeys.has(key) && !stored) drafts.push({ sourceHash: value.sourceHash, workbookKind: value.kind, entityType: 'specialty', sheetName: value.sheet, sourceRow: value.row, rowKey: key, issueCode: 'specialty_new_value', severity: 'warning', message: `Specialty “${value.name}” is new and will be added as written.`, suggestedAction: 'Confirm the spelling or map it to an existing specialty.' });
  }

  const diagnosisKeys = new Set(diagnosisRows.flatMap((row) => [normalizeKeyPart(row.code), ...row.aliases.map(normalizeKeyPart)]));
  for (const call of plan.calls) {
    const key = normalizeKeyPart(call.diagnosisCode);
    const stored = storedMappingRows.find((mapping) => mapping.mappingType === 'diagnosis' && mapping.normalizedValue === key);
    if (key && !diagnosisKeys.has(key) && !stored) {
      drafts.push({ sourceHash: call.source.sourceHash, workbookKind: call.source.workbookKind, entityType: 'diagnosis', sheetName: call.source.sheetName, sourceRow: call.source.rowNumber, rowKey: key, issueCode: 'diagnosis_new_value', severity: 'warning', message: `Diagnosis code “${call.diagnosisCode}” is new and will be added.`, suggestedAction: 'Confirm the code or map it to an existing diagnosis.' });
      diagnosisKeys.add(key);
    }
  }

  const usersByInitials = new Map<string, string[]>();
  for (const user of currentUserRows) {
    const key = normalizeKeyPart(user.initials);
    usersByInitials.set(key, [...(usersByInitials.get(key) ?? []), user.id]);
  }
  const actorCandidates = new Map<string, { initials: string; sourceHash: string; kind: WorkbookKind; sheet: string; row: number }>();
  for (const call of plan.calls) {
    const key = normalizeKeyPart(call.callerInitials);
    if (key && !actorCandidates.has(key)) actorCandidates.set(key, { initials: call.callerInitials!, sourceHash: call.source.sourceHash, kind: call.source.workbookKind, sheet: call.source.sheetName, row: call.source.rowNumber });
  }
  for (const [key, actor] of actorCandidates) {
    const matches = usersByInitials.get(key) ?? [];
    const stored = storedMappingRows.find((mapping) => mapping.mappingType === 'actor' && mapping.normalizedValue === key);
    if (matches.length === 1 || stored) continue;
    drafts.push({ sourceHash: actor.sourceHash, workbookKind: actor.kind, entityType: 'actor', sheetName: actor.sheet, sourceRow: actor.row, rowKey: key, issueCode: matches.length > 1 ? 'legacy_actor_ambiguous' : 'legacy_actor_unmapped', severity: matches.length > 1 ? 'error' : 'warning', message: matches.length > 1 ? `Legacy initials “${actor.initials}” match more than one current user.` : `Legacy initials “${actor.initials}” are not linked to a current user.`, suggestedAction: matches.length > 1 ? 'Choose the correct current user.' : 'Link a current user or keep this as a legacy-only actor.' });
  }

  const unique = new Map<string, DiagnosticDraft>();
  for (const draft of drafts) {
    const key = [draft.sourceHash, draft.entityType, draft.sheetName, draft.sourceRow, draft.issueCode].join('|');
    if (!unique.has(key)) unique.set(key, draft);
  }
  return [...unique.values()];
}

function readinessForDiagnostics(plan: ImportPlan, diagnostics: DiagnosticDraft[]): MigrationReadiness {
  if (diagnostics.some((item) => item.severity === 'error')) return 'no_go';
  const base = migrationReadiness(plan);
  return diagnostics.length && base === 'go' ? 'go_with_warnings' : base;
}

export async function previewMigration(principal: Principal, workbooks: UploadedWorkbook[], request?: Request) {
  const plan = await parseUploads(workbooks);
  const diagnostics = await buildDiagnostics(plan);
  const reconciliation = reconcilePreviewRows(plan);
  const readiness = readinessForDiagnostics(plan, diagnostics);
  const summary = safeImportSummary(plan, 12);
  const db = requireDatabaseClient();
  const [run] = await db.transaction(async (tx) => {
    const inserted = await tx.insert(migrationRuns).values({
      importerVersion: plan.importerVersion,
      status: 'previewed',
      releaseVersion: getReleaseIdentifier(),
      sourceManifest: { sources: plan.sources.map((source) => ({ workbookKind: source.workbookKind, sourceFileName: source.sourceFileName, sourceHash: source.sourceHash, sizeBytes: source.sizeBytes, schemaVersion: source.schemaVersion })) },
      previewCounts: plan.counts,
      reconciliation: { ...reconciliation, stateDistribution: legacyStateDistribution(plan), reportComparison: sourceReportComparison(plan) },
      readiness,
      previewedBy: principal.id,
    }).returning();
    await tx.insert(migrationSources).values(plan.sources.map((source) => ({
      migrationRunId: inserted[0].id,
      workbookKind: source.workbookKind,
      sourceFileName: source.sourceFileName,
      sourceHash: source.sourceHash,
      sourceSizeBytes: source.sizeBytes,
      schemaVersion: source.schemaVersion,
      sheets: source.sheetDetails,
      rowsScanned: source.sheetDetails.reduce((sum, sheet) => sum + sheet.rowsVisited, 0),
      formulaCells: source.formulaCells,
      hiddenRows: source.hiddenRows,
    })));
    if (diagnostics.length) await tx.insert(migrationDiagnostics).values(diagnostics.map((item) => ({ migrationRunId: inserted[0].id, ...item })));
    await tx.insert(auditEvents).values({ ...buildAuditEvent({ actorId: principal.id, action: 'migration.preview', result: 'success', entityType: 'migration_run', entityId: inserted[0].id, request }), afterJson: { readiness, sourceHashes: plan.sources.map((source) => source.sourceHash), counts: plan.counts } });
    return inserted;
  });
  return { run: serializeRun(run), summary, diagnostics: diagnostics.slice(0, 100), diagnosticCount: diagnostics.length };
}

function serializeRun<T extends Record<string, unknown>>(run: T) {
  return Object.fromEntries(Object.entries(run).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}

export async function listMigrationRuns() {
  const db = requireDatabaseClient();
  const rows = await db.select().from(migrationRuns).orderBy(desc(migrationRuns.createdAt)).limit(50);
  return rows.map(serializeRun);
}

export async function getMigrationRun(runId: string) {
  validatedMigrationId(runId);
  const db = requireDatabaseClient();
  const [run, sources, diagnostics, reconciliation] = await Promise.all([
    db.select().from(migrationRuns).where(eq(migrationRuns.id, runId)).limit(1),
    db.select().from(migrationSources).where(eq(migrationSources.migrationRunId, runId)),
    db.select().from(migrationDiagnostics).where(eq(migrationDiagnostics.migrationRunId, runId)).orderBy(desc(migrationDiagnostics.severity), migrationDiagnostics.sourceRow).limit(1000),
    db.select().from(migrationReconciliations).where(eq(migrationReconciliations.migrationRunId, runId)).limit(1),
  ]);
  if (!run[0]) throw new MigrationServiceError('Migration run was not found.', 404);
  return { run: serializeRun(run[0]), sources: sources.map(serializeRun), diagnostics: diagnostics.map(serializeRun), reconciliation: reconciliation[0] ? serializeRun(reconciliation[0]) : null };
}

async function verifyManifest(runId: string, plan: ImportPlan) {
  const db = requireDatabaseClient();
  const stored = await db.select({ kind: migrationSources.workbookKind, hash: migrationSources.sourceHash, size: migrationSources.sourceSizeBytes }).from(migrationSources).where(eq(migrationSources.migrationRunId, runId));
  const expected = stored.map((item) => `${item.kind}:${item.hash}:${item.size}`).sort();
  const actual = plan.sources.map((item) => `${item.workbookKind}:${item.sourceHash}:${item.sizeBytes}`).sort();
  if (expected.length !== actual.length || expected.some((item, index) => item !== actual[index])) {
    throw new MigrationServiceError('Uploaded workbooks do not match this preview. Run a new preview.', 409);
  }
}

async function applyResolvedDecisions(runId: string, plan: ImportPlan) {
  const db = requireDatabaseClient();
  const [decisions, storedMappings] = await Promise.all([
    db.select().from(migrationDiagnostics).where(and(eq(migrationDiagnostics.migrationRunId, runId), inArray(migrationDiagnostics.status, ['resolved', 'skipped']))),
    db.select().from(legacyValueMappings),
  ]);
  const sourceKey = (source: { sourceHash: string; sheetName: string; rowNumber: number }) => `${source.sourceHash}|${source.sheetName}|${source.rowNumber}`;
  const skipped = new Set(decisions
    .filter((item) => item.status === 'skipped' && item.entityType !== 'actor')
    .map((item) => `${item.sourceHash}|${item.sheetName}|${item.sourceRow}`));
  const skippedSpecialties = new Set(storedMappings.filter((item) => item.mappingType === 'specialty' && item.decision === 'skip').map((item) => item.normalizedValue));
  const skippedDiagnoses = new Set(storedMappings.filter((item) => item.mappingType === 'diagnosis' && item.decision === 'skip').map((item) => item.normalizedValue));
  for (const item of plan.facilitySpecialties) if (skippedSpecialties.has(item.normalizedSpecialty)) skipped.add(sourceKey(item.source));
  for (const item of plan.calls) {
    if (skippedSpecialties.has(item.normalizedSpecialty ?? '') || skippedDiagnoses.has(normalizeKeyPart(item.diagnosisCode))) skipped.add(sourceKey(item.source));
  }
  const keep = (source: { sourceHash: string; sheetName: string; rowNumber: number }) => !skipped.has(`${source.sourceHash}|${source.sheetName}|${source.rowNumber}`);
  plan.facilities = plan.facilities.filter((item) => keep(item.source));
  plan.facilitySpecialties = plan.facilitySpecialties.filter((item) => keep(item.source));
  plan.calls = plan.calls.filter((item) => keep(item.source));
  plan.postalCodes = plan.postalCodes.filter((item) => keep(item.source));
  for (const item of plan.stagedRows) {
    if (!keep(item.source)) {
      item.status = 'skipped';
      if (!item.issues.includes('migration_review_skipped')) item.issues.push('migration_review_skipped');
    }
  }

  for (const decision of decisions.filter((item) => item.resolutionAction === 'use_existing' && item.targetEntityId)) {
    if (decision.entityType === 'facility' && decision.rowKey) {
      const target = await db.select().from(facilities).where(eq(facilities.id, decision.targetEntityId!)).limit(1);
      if (!target[0]) throw new MigrationServiceError('A selected facility no longer exists.', 409);
      const original = decision.rowKey;
      plan.facilities = plan.facilities.filter((item) => item.normalizedKey !== original);
      for (const item of plan.facilitySpecialties) if (item.normalizedFacilityKey === original) item.normalizedFacilityKey = `${target[0].normalizedName}|${target[0].normalizedCity}`;
      for (const item of plan.calls) if (item.normalizedFacilityKey === original) item.normalizedFacilityKey = `${target[0].normalizedName}|${target[0].normalizedCity}`;
    }
  }

  const actorMappings: Record<string, string> = {};
  for (const mapping of storedMappings.filter((item) => item.decision === 'mapped' && item.targetEntityId)) {
    if (mapping.mappingType === 'specialty') {
      const target = await db.select().from(specialties).where(eq(specialties.id, mapping.targetEntityId!)).limit(1);
      if (!target[0]) throw new MigrationServiceError('A mapped specialty no longer exists.', 409);
      for (const item of plan.facilitySpecialties) if (item.normalizedSpecialty === mapping.normalizedValue) { item.normalizedSpecialty = target[0].normalizedName; item.specialty = target[0].canonicalName; }
      for (const item of plan.calls) if (item.normalizedSpecialty === mapping.normalizedValue) { item.normalizedSpecialty = target[0].normalizedName; item.specialty = target[0].canonicalName; }
    }
    if (mapping.mappingType === 'diagnosis') {
      const target = await db.select().from(diagnoses).where(eq(diagnoses.id, mapping.targetEntityId!)).limit(1);
      if (!target[0]) throw new MigrationServiceError('A mapped diagnosis no longer exists.', 409);
      for (const item of plan.calls) if (normalizeKeyPart(item.diagnosisCode) === mapping.normalizedValue) item.diagnosisCode = target[0].code;
    }
    if (mapping.mappingType === 'actor') actorMappings[mapping.normalizedValue] = mapping.targetEntityId!;
  }
  return actorMappings;
}

async function finalReconciliation(
  runId: string,
  plan: ImportPlan,
  readiness: MigrationReadiness,
  applied: Awaited<ReturnType<typeof applyImportPlan>>,
) {
  const db = requireDatabaseClient();
  const hashes = plan.sources.map((source) => source.sourceHash);
  const batches = hashes.length ? await db.select({ id: importBatches.id, sourceHash: importBatches.sourceHash }).from(importBatches).where(and(inArray(importBatches.sourceHash, hashes), eq(importBatches.importerVersion, plan.importerVersion))) : [];
  const rowResults = batches.length ? await db.select({ status: importRowResults.status, sourceHash: importBatches.sourceHash }).from(importRowResults).innerJoin(importBatches, eq(importBatches.id, importRowResults.batchId)).where(inArray(importRowResults.batchId, batches.map((batch) => batch.id))) : [];
  const sourceRows = plan.stagedRows.length;
  const existingHashes = new Set(applied.existingSourceHashes);
  const importedRows = rowResults.filter((row) => !existingHashes.has(row.sourceHash) && row.status === 'imported').length;
  const skippedRows = rowResults.filter((row) => row.status === 'skipped').length;
  const invalidRows = rowResults.filter((row) => row.status === 'rejected').length;
  const unchangedRows = rowResults.filter((row) => (
    row.status === 'duplicate'
    || (existingHashes.has(row.sourceHash) && row.status !== 'skipped' && row.status !== 'rejected')
  )).length;
  const reconciledRows = importedRows + unchangedRows + skippedRows + invalidRows;
  const importedCalls = batches.length ? await db.select({ accepting: calls.acceptingNewPatients }).from(calls).where(inArray(calls.importBatchId, batches.map((batch) => batch.id))) : [];
  const databaseAccepting = { yes: 0, no: 0, unknown: 0, notApplicable: 0 };
  for (const row of importedCalls) {
    if (row.accepting === 'yes') databaseAccepting.yes += 1;
    else if (row.accepting === 'no') databaseAccepting.no += 1;
    else if (row.accepting === 'not_applicable') databaseAccepting.notApplicable += 1;
    else databaseAccepting.unknown += 1;
  }
  const sourceComparison = sourceReportComparison(plan);
  const reportComparison = { source: sourceComparison, database: { calls: importedCalls.length, accepting: databaseAccepting, acceptingRateDenominator: databaseAccepting.yes + databaseAccepting.no }, matches: sourceComparison.calls === importedCalls.length && JSON.stringify(sourceComparison.accepting) === JSON.stringify(databaseAccepting) };
  const record = {
    migrationRunId: runId, sourceRows, reconciledRows, importedRows, updatedRows: 0, unchangedRows,
    skippedRows, conflictRows: 0, invalidRows,
    reconciliationPercent: sourceRows === 0 ? 100 : Number(((reconciledRows / sourceRows) * 100).toFixed(4)),
    relationshipCounts: { facilities: plan.facilities.length, facilitySpecialties: plan.facilitySpecialties.length, calls: plan.calls.length, postalCodes: plan.postalCodes.length },
    stateDistribution: legacyStateDistribution(plan), reportComparison,
    discrepancies: reportComparison.matches ? [] : [{ code: 'report_parity_mismatch', message: 'Imported call totals do not match the source preview.' }],
    readiness: reportComparison.matches && reconciledRows === sourceRows && invalidRows === 0 ? readiness : ('no_go' as const),
  };
  await db.insert(migrationReconciliations).values(record).onConflictDoUpdate({ target: migrationReconciliations.migrationRunId, set: record });
  return record;
}

export async function applyMigration(principal: Principal, runId: string, workbooks: UploadedWorkbook[], input: z.infer<typeof applyMigrationSchema>, request?: Request) {
  validatedMigrationId(runId);
  const db = requireDatabaseClient();
  const current = await db.select().from(migrationRuns).where(eq(migrationRuns.id, runId)).limit(1);
  if (!current[0]) throw new MigrationServiceError('Migration run was not found.', 404);
  if (!['previewed', 'failed'].includes(current[0].status)) throw new MigrationServiceError('This migration run cannot be applied in its current state.', 409);
  const blockers = await db.select({ id: migrationDiagnostics.id }).from(migrationDiagnostics).where(and(eq(migrationDiagnostics.migrationRunId, runId), eq(migrationDiagnostics.severity, 'error'), inArray(migrationDiagnostics.status, ['open', 'deferred']))).limit(1);
  if (blockers.length) throw new MigrationServiceError('Resolve or skip all blocking diagnostics before applying.', 409);
  const plan = await parseUploads(workbooks);
  await verifyManifest(runId, plan);
  const legacyActorUserIds = await applyResolvedDecisions(runId, plan);
  const pool = getDatabasePool();
  if (!pool) throw new MigrationServiceError('Database configuration is required.', 503);
  const lock = await pool.connect();
  let locked = false;
  try {
    const result = await lock.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [`provider-tracker:migration:${plan.sources.map((source) => source.sourceHash).sort().join(':')}`]);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new MigrationServiceError('Another migration using these files is already running.', 409);
    const baseline = new Date();
    await db.update(migrationRuns).set({ status: 'running', approvedBy: principal.id, executedBy: principal.id, approvalReason: input.reason, approvedAt: baseline, startedAt: baseline, notificationBaselineAt: baseline, failureCategory: null, failureMessage: null, updatedAt: sql`now()` }).where(eq(migrationRuns.id, runId));
    const options: ApplyImportOptions = { actorId: principal.id, migrationRunId: runId, notificationBaselineAt: baseline, simulateFailureAfterStaging: input.simulateFailureAfterStaging, legacyActorUserIds };
    const applied = await applyImportPlan(plan, options);
    const readiness = current[0].readiness === 'no_go' ? 'go_with_warnings' : current[0].readiness;
    const reconciliation = await finalReconciliation(runId, plan, readiness, applied);
    await db.transaction(async (tx) => {
      await tx.update(migrationRuns).set({ status: 'reconciled', applyCounts: applied, reconciliation, readiness: reconciliation.readiness, completedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(migrationRuns.id, runId));
      await tx.insert(auditEvents).values({ ...buildAuditEvent({ actorId: principal.id, action: 'migration.apply', result: 'success', entityType: 'migration_run', entityId: runId, request, metadata: { reason: input.reason } }), afterJson: { applied, reconciliation } });
    });
    return { applied, reconciliation };
  } catch (error) {
    await db.update(migrationRuns).set({ status: 'failed', failureCategory: error instanceof MigrationServiceError ? 'validation_or_lock' : 'apply_failure', failureMessage: error instanceof Error ? error.message.slice(0, 500) : 'Migration failed.', updatedAt: sql`now()` }).where(and(eq(migrationRuns.id, runId), eq(migrationRuns.status, 'running')));
    await db.insert(auditEvents).values(buildAuditEvent({ actorId: principal.id, action: 'migration.apply', result: 'failure', entityType: 'migration_run', entityId: runId, request, metadata: { reason: input.reason } }));
    throw error;
  } finally {
    if (locked) await lock.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`provider-tracker:migration:${plan.sources.map((source) => source.sourceHash).sort().join(':')}`]);
    lock.release();
  }
}

export async function resolveMigrationDiagnostic(principal: Principal, runId: string, diagnosticId: string, input: z.infer<typeof diagnosticResolutionSchema>, request?: Request) {
  validatedMigrationId(runId); validatedMigrationId(diagnosticId);
  const db = requireDatabaseClient();
  const found = await db.select().from(migrationDiagnostics).where(and(eq(migrationDiagnostics.id, diagnosticId), eq(migrationDiagnostics.migrationRunId, runId))).limit(1);
  if (!found[0]) throw new MigrationServiceError('Migration diagnostic was not found.', 404);
  if (input.action === 'use_existing' && !input.targetEntityId) throw new MigrationServiceError('Choose the existing record to use.');
  if (input.action === 'use_existing' && input.targetEntityId) {
    const targetExists = found[0].entityType === 'facility'
      ? (await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, input.targetEntityId)).limit(1)).length > 0
      : found[0].entityType === 'specialty'
        ? (await db.select({ id: specialties.id }).from(specialties).where(eq(specialties.id, input.targetEntityId)).limit(1)).length > 0
        : found[0].entityType === 'diagnosis'
          ? (await db.select({ id: diagnoses.id }).from(diagnoses).where(eq(diagnoses.id, input.targetEntityId)).limit(1)).length > 0
          : found[0].entityType === 'actor'
            ? (await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.targetEntityId), eq(users.isActive, true))).limit(1)).length > 0
            : false;
    if (!targetExists) throw new MigrationServiceError('The selected target does not exist for this review item.', 404);
  }
  if (input.action === 'create_new' && !['specialty', 'diagnosis'].includes(found[0].entityType)) throw new MigrationServiceError('This item cannot be created from the diagnostic screen.');
  let targetEntityId = input.targetEntityId ?? null;
  if (input.action === 'create_new') {
    if (!found[0].rowKey) throw new MigrationServiceError('The source value is missing.');
    if (found[0].entityType === 'specialty') {
      const [created] = await db.insert(specialties).values({ canonicalName: found[0].rowKey, normalizedName: found[0].rowKey }).onConflictDoUpdate({ target: specialties.normalizedName, set: { updatedAt: sql`now()` } }).returning({ id: specialties.id });
      targetEntityId = created.id;
    } else {
      const [created] = await db.insert(diagnoses).values({ code: found[0].rowKey.toUpperCase(), description: 'Imported legacy diagnosis' }).onConflictDoUpdate({ target: diagnoses.code, set: { updatedAt: sql`now()` } }).returning({ id: diagnoses.id });
      targetEntityId = created.id;
    }
  }
  const status = input.action === 'defer' ? 'deferred' : input.action === 'skip' ? 'skipped' : 'resolved';
  const updated = await db.update(migrationDiagnostics).set({ status, resolutionAction: input.action, targetEntityId, resolutionNote: input.note, resolvedBy: principal.id, resolvedAt: input.action === 'defer' ? null : sql`now()`, optimisticLockVersion: sql`${migrationDiagnostics.optimisticLockVersion} + 1`, updatedAt: sql`now()` }).where(and(eq(migrationDiagnostics.id, diagnosticId), eq(migrationDiagnostics.migrationRunId, runId), eq(migrationDiagnostics.optimisticLockVersion, input.version))).returning();
  if (!updated[0]) throw new MigrationServiceError('This diagnostic changed after you opened it. Reload and try again.', 409);
  if (input.action !== 'defer' && found[0].rowKey && ['specialty', 'diagnosis', 'actor'].includes(found[0].entityType)) {
    await db.insert(legacyValueMappings).values({
      mappingType: found[0].entityType,
      sourceValue: found[0].rowKey,
      normalizedValue: found[0].rowKey,
      targetEntityId: input.action === 'skip' ? null : targetEntityId,
      decision: input.action === 'skip' ? 'skip' : 'mapped',
      createdBy: principal.id,
    }).onConflictDoUpdate({
      target: [legacyValueMappings.mappingType, legacyValueMappings.normalizedValue],
      set: {
        targetEntityId: input.action === 'skip' ? null : targetEntityId,
        decision: input.action === 'skip' ? 'skip' : 'mapped',
        createdBy: principal.id,
        updatedAt: sql`now()`,
      },
    });
  }
  await db.insert(auditEvents).values({ ...buildAuditEvent({ actorId: principal.id, action: 'migration.diagnostic.resolve', result: 'success', entityType: 'migration_diagnostic', entityId: diagnosticId, request, metadata: { note: input.note } }), afterJson: { runId, action: input.action, targetEntityId } });
  return serializeRun(updated[0]);
}

export async function exportMigrationDiagnostics(runId: string) {
  const details = await getMigrationRun(runId);
  const headers = ['id', 'status', 'severity', 'entity_type', 'sheet', 'source_row', 'issue_code', 'message', 'suggested_action', 'resolution_action', 'resolution_note'];
  const lines = [headers.map(migrationCsvCell).join(',')];
  for (const item of details.diagnostics as Array<Record<string, unknown>>) lines.push([item.id, item.status, item.severity, item.entityType, item.sheetName, item.sourceRow, item.issueCode, item.message, item.suggestedAction, item.resolutionAction, item.resolutionNote].map(migrationCsvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export async function assessOrReverseMigration(principal: Principal, runId: string, input: z.infer<typeof reversalSchema>, request?: Request) {
  validatedMigrationId(runId);
  if (input.confirmRunId !== runId) throw new MigrationServiceError('Run confirmation does not match.', 409);
  const pool = getDatabasePool();
  const db = requireDatabaseClient();
  if (!pool) throw new MigrationServiceError('Database configuration is required.', 503);
  const run = await db.select().from(migrationRuns).where(eq(migrationRuns.id, runId)).limit(1);
  if (!run[0]) throw new MigrationServiceError('Migration run was not found.', 404);
  if (run[0].status !== 'reconciled') throw new MigrationServiceError('Only a reconciled migration can be reversed.', 409);
  const assessment = await pool.query<{ preexisting_touched: number; later_activity: number; material_rows: number }>(`
    WITH batch AS (SELECT id FROM import_batches WHERE migration_run_id=$1),
    touched AS (SELECT DISTINCT facility_id FROM calls WHERE import_batch_id IN (SELECT id FROM batch) AND facility_id IS NOT NULL)
    SELECT
      (SELECT count(*)::int FROM facilities f JOIN touched t ON t.facility_id=f.id WHERE f.created_at < $2) AS preexisting_touched,
      (SELECT count(*)::int FROM calls c JOIN touched t ON t.facility_id=c.facility_id WHERE c.import_batch_id NOT IN (SELECT id FROM batch) AND c.created_at > $3) +
      (SELECT count(*)::int FROM facility_verification_events v JOIN touched t ON t.facility_id=v.facility_id WHERE v.import_batch_id IS NULL AND v.created_at > $3) AS later_activity,
      (SELECT coalesce(sum(
        coalesce((counts->>'stagedRows')::int,0) + coalesce((counts->>'calls')::int,0)
        + coalesce((counts->>'facilities')::int,0) + coalesce((counts->>'facilitySpecialties')::int,0)
        + coalesce((counts->>'postalCodes')::int,0)
      ),0)::int FROM import_batches WHERE migration_run_id=$1) AS material_rows`, [runId, run[0].startedAt, run[0].completedAt]);
  const safe = assessment.rows[0]?.preexisting_touched === 0
    && assessment.rows[0]?.later_activity === 0
    && assessment.rows[0]?.material_rows === 0;
  const result = { safe, ...assessment.rows[0], action: safe ? 'database_reversal_available' : 'restore_from_cutover_backup_required' };
  if (input.dryRun) return result;
  if (!safe) throw new MigrationServiceError('This run changed existing records or has later activity. Restore the cutover backup instead of deleting rows.', 409);
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM facility_contact_attempts WHERE related_call_id IN (SELECT c.id FROM calls c JOIN import_batches b ON b.id=c.import_batch_id WHERE b.migration_run_id=${runId})`);
    await tx.execute(sql`DELETE FROM facility_verification_events WHERE import_batch_id IN (SELECT id FROM import_batches WHERE migration_run_id=${runId})`);
    await tx.execute(sql`DELETE FROM calls WHERE import_batch_id IN (SELECT id FROM import_batches WHERE migration_run_id=${runId})`);
    await tx.execute(sql`DELETE FROM import_row_results WHERE batch_id IN (SELECT id FROM import_batches WHERE migration_run_id=${runId})`);
    await tx.execute(sql`DELETE FROM import_batches WHERE migration_run_id=${runId}`);
    await tx.update(migrationRuns).set({ status: 'reversed', readiness: 'no_go', reversedBy: principal.id, reversalReason: input.reason, reversedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(migrationRuns.id, runId));
    await tx.insert(auditEvents).values({ ...buildAuditEvent({ actorId: principal.id, action: 'migration.reverse', result: 'success', entityType: 'migration_run', entityId: runId, request, metadata: { reason: input.reason } }), beforeJson: result });
  });
  return { ...result, reversed: true };
}

export function migrationServiceErrorResponse(error: unknown): Response | null {
  if (error instanceof MigrationServiceError) return Response.json({ error: error.message }, { status: error.status });
  return null;
}
