import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  cleanText,
  dateOnlyInZone,
  deriveResult,
  isDidNotLeaveVm,
  makeFacilityIdentity,
  normalizeHeader,
  normalizePhone,
  normalizePostalCode,
  normalizeSpecialty,
  nullableText,
  parseWorkbookDate,
  scalarToText,
  splitFacilityKey,
  stableHash,
  toAvailabilityStatus,
  toBoolean,
  toFiniteNumber,
  toLegacySemanticStatus,
  toScheduleStatus,
  toTreatmentStatus,
  weekStartForDate,
} from './normalization';
import type {
  CallCandidate,
  FacilityCandidate,
  FacilitySpecialtyCandidate,
  ImportIssue,
  ParsedWorkbook,
  PostalCodeCandidate,
  ScalarCell,
  SourceRef,
  StagedRow,
  WorkbookKind,
} from './types';
import { streamWorkbook } from './xlsx-stream';

const TARGET_SHEETS: Record<WorkbookKind, ReadonlySet<string>> = {
  admin: new Set([
    'Facilities',
    'Facility-Specialty Map',
    'tblWeeklyCallLog',
    'Monthly Archive',
    'Zip Coordinates',
  ]),
  user: new Set(['Facilities', 'Facility-Specialty Map', 'Weekly Call Log', 'Zip Coordinates']),
};

const ALLOWED_SHEETS: Record<WorkbookKind, ReadonlySet<string>> = {
  admin: new Set([
    ...TARGET_SHEETS.admin,
    'Weekly Report Snapshot',
    'Monthly Report Snapshot',
    'Monthly Report Archive',
    'Scheduling Trend Tracker',
    '_Config',
  ]),
  user: new Set([
    ...TARGET_SHEETS.user,
    'Provider search',
    'tbl30DayLookBack',
    'Authorization Output',
    'Lists',
  ]),
};

const IMPORT_SCHEMA_VERSION = 'provider-workbook-v2';

const ignoredReferralWorkflowHeaders = new Set([
  'referraltype',
  'referralreason',
  'reasonforoonreferral',
]);

export function isSensitiveIdentifierHeader(header: string) {
  return /^(?:auth|authorization)(?:number|num|no)?$/.test(header);
}

const REQUIRED_HEADER_GROUPS: Record<string, string[][]> = {
  Facilities: [['Facility', 'Facility Name', 'Facility Key']],
  'Facility-Specialty Map': [['Facility Key', 'Facility Name'], ['Specialty']],
  'Zip Coordinates': [['Zip Code', 'Zipcode', 'Postal Code'], ['Latitude'], ['Longitude']],
  tblWeeklyCallLog: [['Facility Name', 'Facility Key'], ['Call Date/Time', 'Call Date']],
  'Weekly Call Log': [['Facility Name', 'Facility Key'], ['Call Date/Time', 'Call Date']],
  'Monthly Archive': [['Facility Name', 'Facility Key'], ['Call Date/Time', 'Call Date']],
};

type RowRecord = {
  rawData: Record<string, ScalarCell>;
  normalized: Map<string, ScalarCell>;
};

async function hashFile(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function rowRecord(headers: string[], cells: ScalarCell[]): RowRecord {
  const rawData: Record<string, ScalarCell> = {};
  const normalized = new Map<string, ScalarCell>();
  headers.forEach((header, index) => {
    if (!header) return;
    const normalizedHeader = normalizeHeader(header);
    if (ignoredReferralWorkflowHeaders.has(normalizedHeader) || isSensitiveIdentifierHeader(normalizedHeader)) return;
    const value = cells[index] ?? null;
    rawData[header] = value;
    normalized.set(normalizedHeader, value);
  });
  return { rawData, normalized };
}

function pick(record: RowRecord, ...aliases: string[]) {
  for (const alias of aliases) {
    const value = record.normalized.get(normalizeHeader(alias));
    if (value !== undefined && value !== null && scalarToText(value) !== '') return value;
  }
  return null;
}

function makeSource(
  workbookKind: WorkbookKind,
  sourceFileName: string,
  sourceHash: string,
  sheetName: string,
  rowNumber: number,
): SourceRef {
  return { workbookKind, sourceFileName, sourceHash, sheetName, rowNumber };
}

function pushIssue(
  issues: ImportIssue[],
  localIssues: string[],
  code: string,
  severity: 'warning' | 'error',
  source: SourceRef,
  message: string,
) {
  localIssues.push(code);
  issues.push({ code, severity, source, message });
}

function facilityFromRow(record: RowRecord, source: SourceRef, issues: ImportIssue[]) {
  const facilityKey = scalarToText(pick(record, 'Facility Key'));
  const keyParts = splitFacilityKey(facilityKey);
  const name = scalarToText(pick(record, 'Facility', 'Facility Name')) || keyParts.facilityName;
  const city = scalarToText(pick(record, 'Location / City', 'Location', 'City')) || keyParts.city;
  if (!name && !facilityKey) return null;
  if (normalizeHeader(name) === 'facility' || normalizeHeader(facilityKey) === 'facilitykey') return null;

  const identity = makeFacilityIdentity(name, city);
  const localIssues: string[] = [];
  const latitude = toFiniteNumber(pick(record, 'Latitude'));
  const longitude = toFiniteNumber(pick(record, 'Longitude'));
  if (!identity.city) {
    pushIssue(issues, localIssues, 'facility_missing_city', 'warning', source, 'Facility has no city in its master row.');
  }
  if (latitude === null || longitude === null) {
    pushIssue(
      issues,
      localIssues,
      'facility_missing_coordinates',
      'warning',
      source,
      'Facility requires ZIP-centroid fallback or coordinate review.',
    );
  }

  const phoneRaw = nullableText(pick(record, 'Phone Number', 'Phone'));
  const legacyStatus = nullableText(pick(record, 'Record Status', 'Status', 'Active'));
  const normalizedLegacyStatus = cleanText(legacyStatus).toLowerCase();
  const candidate: FacilityCandidate = {
    source,
    fingerprint: stableHash('facility', identity.normalizedKey),
    ...identity,
    facilityType: scalarToText(pick(record, 'Facility Type')) || 'Hospital',
    autoFillSpecialty: toBoolean(pick(record, 'Auto Fill Specialty?', 'Auto Fill Specialty')),
    active: !['inactive', 'archived', 'no', 'false', '0'].includes(normalizedLegacyStatus),
    legacyStatus,
    phoneRaw,
    phoneNormalized: normalizePhone(phoneRaw),
    postalCode: normalizePostalCode(pick(record, 'Zipcode', 'ZIP Code', 'Postal Code')),
    latitude,
    longitude,
    issues: localIssues,
  };
  return candidate;
}

function facilitySpecialtyFromRow(record: RowRecord, source: SourceRef, issues: ImportIssue[]) {
  const facilityKey = scalarToText(pick(record, 'Facility Key', 'Facility Name'));
  const specialty = cleanText(pick(record, 'Specialty'));
  if (!facilityKey && !specialty) return null;
  if (normalizeHeader(facilityKey) === 'facilitykey' || normalizeHeader(specialty) === 'specialty') return null;

  const localIssues: string[] = [];
  if (!facilityKey || !specialty) {
    pushIssue(
      issues,
      localIssues,
      'mapping_missing_identity',
      'error',
      source,
      'Facility-specialty row is missing its facility or specialty.',
    );
  }
  const parts = splitFacilityKey(facilityKey);
  const identity = makeFacilityIdentity(parts.facilityName, parts.city);
  const normalizedSpecialty = normalizeSpecialty(specialty);
  const candidate: FacilitySpecialtyCandidate = {
    source,
    fingerprint: stableHash('facility_specialty', identity.normalizedKey, normalizedSpecialty),
    facilityDisplayKey: identity.displayKey,
    normalizedFacilityKey: identity.normalizedKey,
    specialty,
    normalizedSpecialty,
    treatmentStatus: toTreatmentStatus(pick(record, 'Treats This Specialty', 'Can Treat Diagnosis')),
    notes: nullableText(pick(record, 'Notes')),
    issues: localIssues,
  };
  return candidate;
}

function postalCodeFromRow(record: RowRecord, source: SourceRef, issues: ImportIssue[]) {
  const zipCode = normalizePostalCode(pick(record, 'Zip Code', 'Zipcode', 'Postal Code'));
  const latitude = toFiniteNumber(pick(record, 'Latitude'));
  const longitude = toFiniteNumber(pick(record, 'Longitude'));
  if (!zipCode && latitude === null && longitude === null) return null;
  if (normalizeHeader(scalarToText(pick(record, 'Zip Code'))) === 'zipcode') return null;

  const localIssues: string[] = [];
  if (!zipCode || latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    pushIssue(
      issues,
      localIssues,
      'postal_code_invalid',
      'error',
      source,
      'ZIP centroid row has a missing or invalid ZIP/latitude/longitude value.',
    );
  }
  if (!zipCode || latitude === null || longitude === null) return { rejected: true as const, localIssues };

  const candidate: PostalCodeCandidate = {
    source,
    fingerprint: stableHash('postal_code', zipCode),
    zipCode,
    latitude,
    longitude,
    issues: localIssues,
  };
  return { rejected: false as const, candidate, localIssues };
}

function callFromRow(
  record: RowRecord,
  source: SourceRef,
  dateSystem: '1900' | '1904',
  issues: ImportIssue[],
) {
  const callerInitials = nullableText(pick(record, 'Caller Initials', 'URA Initials'));
  const facilityValue = scalarToText(pick(record, 'Facility Name', 'Facility Key'));
  const specialty = nullableText(pick(record, 'Specialty'));
  const diagnosisCode = nullableText(pick(record, 'ICD-10 Code', 'Diagnosis Code'));
  const diagnosisDescription = nullableText(pick(record, 'Diagnosis Description'));
  const phone = nullableText(pick(record, 'Phone Number'));
  const notes = nullableText(pick(record, 'Notes'));

  const hasOperationalIdentity = [
    callerInitials,
    facilityValue,
    specialty,
    diagnosisCode,
    phone,
    notes,
  ].some(Boolean);
  if (!hasOperationalIdentity) return { scaffold: true as const };

  const localIssues: string[] = [];
  const manualOverrideValue = pick(record, 'Manual Call Time Override');
  const manualOverride = parseWorkbookDate(manualOverrideValue, dateSystem);
  if (manualOverrideValue && !manualOverride) {
    pushIssue(
      issues,
      localIssues,
      'call_manual_override_invalid',
      'warning',
      source,
      'Manual call-time override could not be parsed; the primary call timestamp will be used.',
    );
  }
  const primaryCallAt = parseWorkbookDate(pick(record, 'Call Date/Time', 'Call Date'), dateSystem);
  const callAt = manualOverride ?? primaryCallAt;
  if (!facilityValue) {
    pushIssue(issues, localIssues, 'call_missing_facility', 'error', source, 'Call row is missing its facility.');
  }
  if (!callAt) {
    pushIssue(issues, localIssues, 'call_missing_timestamp', 'error', source, 'Call row has no parseable call timestamp.');
  }
  if (!facilityValue || !callAt) return { scaffold: false as const, rejected: true as const, localIssues };

  if (!callerInitials) {
    pushIssue(
      issues,
      localIssues,
      'call_missing_initials',
      'warning',
      source,
      'Call row has no caller initials and will remain unassigned after import.',
    );
  }

  const facilityParts = splitFacilityKey(facilityValue);
  const facilityIdentity = makeFacilityIdentity(facilityParts.facilityName, facilityParts.city);
  const didNotLeaveVm = isDidNotLeaveVm(pick(record, 'Did not leave VM', 'Unable to contact Did not leave VM'));
  const acceptingNewPatients = toAvailabilityStatus(pick(record, 'Accepting New Patients'));
  const canTreatDiagnosis = toTreatmentStatus(pick(record, 'Can Treat Diagnosis'));
  const canScheduleWithinFourWeeks = toBoolean(pick(record, 'Urgent Referral Required'))
    ? 'urgent_referral_required'
    : toScheduleStatus(pick(record, 'Can Schedule Within 4 Weeks', 'Can Schedule W/in 4 Weeks'));
  const result = deriveResult({
    didNotLeaveVm,
    accepting: acceptingNewPatients,
    canTreat: canTreatDiagnosis,
    schedule: canScheduleWithinFourWeeks,
  });
  const importedResultPhrase = nullableText(pick(record, 'Output Phrase', 'Result Phrase'));
  if (
    importedResultPhrase &&
    cleanText(importedResultPhrase).toLowerCase() !== cleanText(result.resultPhrase).toLowerCase()
  ) {
    pushIssue(
      issues,
      localIssues,
      'call_cached_result_mismatch',
      'warning',
      source,
      'Cached workbook result differs from the canonical rule result; canonical result will be imported.',
    );
  }

  const explicitWeekStart = parseWorkbookDate(pick(record, 'Week Start'), dateSystem);
  const weekStart = explicitWeekStart ? dateOnlyInZone(explicitWeekStart) : weekStartForDate(callAt);
  const callAtIso = callAt.toISOString();
  const normalizedSpecialty = specialty ? normalizeSpecialty(specialty) : null;
  const normalizedDiagnosis = diagnosisCode ? cleanText(diagnosisCode).toUpperCase() : null;
  const normalizedInitials = callerInitials ? cleanText(callerInitials).toUpperCase() : '';
  const fingerprint = stableHash(
    'call',
    normalizedInitials,
    callAtIso,
    facilityIdentity.normalizedKey,
    normalizedSpecialty,
    normalizedDiagnosis,
  );
  const logicalFingerprint = stableHash(
    'call_logical',
    normalizedInitials,
    dateOnlyInZone(callAt),
    facilityIdentity.normalizedKey,
    normalizedSpecialty,
    normalizedDiagnosis,
  );

  const candidate: CallCandidate = {
    source,
    fingerprint,
    logicalFingerprint,
    callAt: callAtIso,
    callerInitials: callerInitials ? normalizedInitials : null,
    lob: nullableText(pick(record, 'LOB')),
    facilityDisplayKey: facilityIdentity.displayKey,
    normalizedFacilityKey: facilityIdentity.normalizedKey,
    specialty,
    normalizedSpecialty,
    diagnosisCode: normalizedDiagnosis,
    diagnosisDescription,
    phone,
    didNotLeaveVm,
    acceptingNewPatients,
    canTreatDiagnosis,
    canScheduleWithinFourWeeks,
    notes,
    specialtyConfirmed: toAvailabilityStatus(pick(record, 'Specialty Confirmed')),
    weekStart,
    duplicateGroupKey: stableHash('weekly_duplicate', facilityIdentity.normalizedKey, normalizedDiagnosis, weekStart),
    ...result,
    importedResultPhrase,
    legacyAnswers: {
      accepting: toLegacySemanticStatus(pick(record, 'Accepting New Patients')),
      diagnosis: toLegacySemanticStatus(pick(record, 'Can Treat Diagnosis')),
      scheduling: toLegacySemanticStatus(pick(record, 'Can Schedule Within 4 Weeks', 'Can Schedule W/in 4 Weeks')),
      specialty: toLegacySemanticStatus(pick(record, 'Specialty Confirmed')),
    },
    issues: localIssues,
  };
  return { scaffold: false as const, rejected: false as const, candidate, localIssues };
}

function normalizedDataForStaging(candidate: object) {
  const normalized = { ...candidate } as Record<string, unknown>;
  delete normalized.source;
  delete normalized.issues;
  return normalized;
}

export async function parseWorkbook(
  sourcePath: string,
  workbookKind: WorkbookKind,
  importerVersion = process.env.IMPORTER_VERSION ?? 'provider-workbook-v2',
): Promise<ParsedWorkbook> {
  const sourceFileName = path.basename(sourcePath);
  const sourceHash = await hashFile(sourcePath);
  const headers = new Map<string, string[]>();
  const facilities: FacilityCandidate[] = [];
  const facilitySpecialties: FacilitySpecialtyCandidate[] = [];
  const calls: CallCandidate[] = [];
  const postalCodes: PostalCodeCandidate[] = [];
  const stagedRows: StagedRow[] = [];
  const issues: ImportIssue[] = [];
  const counts = {
    rowsVisited: 0,
    scaffoldRowsSkipped: 0,
    rejectedRows: 0,
    facilities: 0,
    facilitySpecialties: 0,
    calls: 0,
    postalCodes: 0,
  };

  const streamResult = await streamWorkbook(sourcePath, {
    wantedSheets: TARGET_SHEETS[workbookKind],
    maxFileBytes: Number(process.env.WORKBOOK_MAX_FILE_BYTES ?? 100 * 1024 * 1024),
    maxUncompressedBytes: Number(process.env.WORKBOOK_MAX_UNCOMPRESSED_BYTES ?? 512 * 1024 * 1024),
    maxRowsPerSheet: Number(process.env.WORKBOOK_MAX_ROWS_PER_SHEET ?? 100_000),
    maxZipEntries: Number(process.env.WORKBOOK_MAX_ZIP_ENTRIES ?? 10_000),
    maxCompressionRatio: Number(process.env.WORKBOOK_MAX_COMPRESSION_RATIO ?? 200),
    maxColumnsPerRow: Number(process.env.WORKBOOK_MAX_COLUMNS_PER_ROW ?? 4_096),
    maxCellCharacters: Number(process.env.WORKBOOK_MAX_CELL_CHARACTERS ?? 32_768),
    maxSharedStrings: Number(process.env.WORKBOOK_MAX_SHARED_STRINGS ?? 250_000),
    onRow(sheetName, row, context) {
      if (!headers.has(sheetName)) {
        const headerValues = row.cells.map((cell) => cleanText(cell));
        if (headerValues.some(Boolean)) headers.set(sheetName, headerValues);
        return;
      }

      counts.rowsVisited += 1;
      const source = makeSource(workbookKind, sourceFileName, sourceHash, sheetName, row.rowNumber);
      const record = rowRecord(headers.get(sheetName) ?? [], row.cells);

      if (row.hidden) {
        pushIssue(issues, [], 'hidden_source_row', 'warning', source, 'Hidden source row was included and requires migration review.');
      }

      if (sheetName === 'Facilities') {
        const candidate = facilityFromRow(record, source, issues);
        if (!candidate) {
          counts.scaffoldRowsSkipped += 1;
          return;
        }
        facilities.push(candidate);
        counts.facilities += 1;
        stagedRows.push({
          entityType: 'facility',
          source,
          fingerprint: candidate.fingerprint,
          status: 'staged',
          rawData: record.rawData,
          normalizedData: normalizedDataForStaging(candidate),
          issues: candidate.issues,
        });
        return;
      }

      if (sheetName === 'Facility-Specialty Map') {
        const candidate = facilitySpecialtyFromRow(record, source, issues);
        if (!candidate) {
          counts.scaffoldRowsSkipped += 1;
          return;
        }
        if (candidate.issues.includes('mapping_missing_identity')) counts.rejectedRows += 1;
        else {
          facilitySpecialties.push(candidate);
          counts.facilitySpecialties += 1;
        }
        stagedRows.push({
          entityType: 'facility_specialty',
          source,
          fingerprint: candidate.fingerprint,
          status: candidate.issues.includes('mapping_missing_identity') ? 'rejected' : 'staged',
          rawData: record.rawData,
          normalizedData: normalizedDataForStaging(candidate),
          issues: candidate.issues,
        });
        return;
      }

      if (sheetName === 'Zip Coordinates') {
        const parsed = postalCodeFromRow(record, source, issues);
        if (!parsed) {
          counts.scaffoldRowsSkipped += 1;
          return;
        }
        if (parsed.rejected) {
          counts.rejectedRows += 1;
          stagedRows.push({
            entityType: 'postal_code',
            source,
            fingerprint: stableHash('postal_code_rejected', sheetName, row.rowNumber),
            status: 'rejected',
            rawData: record.rawData,
            normalizedData: {},
            issues: parsed.localIssues,
          });
          return;
        }
        postalCodes.push(parsed.candidate);
        counts.postalCodes += 1;
        stagedRows.push({
          entityType: 'postal_code',
          source,
          fingerprint: parsed.candidate.fingerprint,
          status: 'staged',
          rawData: record.rawData,
          normalizedData: normalizedDataForStaging(parsed.candidate),
          issues: parsed.localIssues,
        });
        return;
      }

      const parsed = callFromRow(record, source, context.dateSystem, issues);
      if (parsed.scaffold) {
        counts.scaffoldRowsSkipped += 1;
        return;
      }
      if (parsed.rejected) {
        counts.rejectedRows += 1;
        stagedRows.push({
          entityType: 'call',
          source,
          fingerprint: stableHash('call_rejected', sheetName, row.rowNumber),
          status: 'rejected',
          rawData: record.rawData,
          normalizedData: {},
          issues: parsed.localIssues,
        });
        return;
      }
      calls.push(parsed.candidate);
      counts.calls += 1;
      stagedRows.push({
        entityType: 'call',
        source,
        fingerprint: parsed.candidate.fingerprint,
        status: 'staged',
        rawData: record.rawData,
        normalizedData: normalizedDataForStaging(parsed.candidate),
        issues: parsed.localIssues,
      });
    },
  });

  const missingSheets = [...TARGET_SHEETS[workbookKind]].filter((sheet) => !streamResult.sheetsSeen.includes(sheet));
  if (missingSheets.length) {
    throw new Error(`${workbookKind} workbook is missing required sheets: ${missingSheets.join(', ')}`);
  }
  const unexpectedSheets = streamResult.sheetsSeen.filter((sheet) => !ALLOWED_SHEETS[workbookKind].has(sheet));
  if (unexpectedSheets.length) {
    throw new Error(`${workbookKind} workbook contains unexpected sheets: ${unexpectedSheets.join(', ')}`);
  }
  for (const sheetName of TARGET_SHEETS[workbookKind]) {
    const normalizedHeaders = new Set((headers.get(sheetName) ?? []).map(normalizeHeader));
    const missingGroups = (REQUIRED_HEADER_GROUPS[sheetName] ?? []).filter(
      (aliases) => !aliases.some((alias) => normalizedHeaders.has(normalizeHeader(alias))),
    );
    if (missingGroups.length) {
      throw new Error(`${sheetName} is missing required columns: ${missingGroups.map((aliases) => aliases.join(' / ')).join(', ')}`);
    }
  }

  return {
    source: {
      workbookKind,
      sourcePath,
      sourceFileName,
      sourceHash,
      sizeBytes: streamResult.sizeBytes,
      importerVersion,
      sheetsSeen: streamResult.sheetsSeen,
      dateSystem: streamResult.dateSystem,
      schemaVersion: IMPORT_SCHEMA_VERSION,
      sheetDetails: streamResult.sheetDetails,
      formulaCells: streamResult.formulaCells,
      hiddenRows: streamResult.hiddenRows,
    },
    counts,
    facilities,
    facilitySpecialties,
    calls,
    postalCodes,
    stagedRows,
    issues,
  };
}
