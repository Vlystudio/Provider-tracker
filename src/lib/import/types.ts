export type WorkbookKind = 'admin' | 'user';
export type ImportEntityType =
  | 'facility'
  | 'facility_specialty'
  | 'call'
  | 'authorization'
  | 'diagnosis'
  | 'specialty'
  | 'line_of_business'
  | 'postal_code';

export type AvailabilityStatus = 'yes' | 'no' | 'unknown' | 'not_applicable';
export type TreatmentStatus = AvailabilityStatus | 'unable_to_tell_without_triage';
export type ScheduleStatus = TreatmentStatus | 'urgent_referral_required';
export type LegacySemanticStatus =
  | 'yes'
  | 'no'
  | 'unknown'
  | 'blank'
  | 'not_asked'
  | 'unable_to_verify'
  | 'not_applicable';
export type ImportRowStatus = 'staged' | 'imported' | 'skipped' | 'rejected' | 'duplicate';
export type ScalarCell = string | number | boolean | null;

export type SourceRef = {
  workbookKind: WorkbookKind;
  sourceFileName: string;
  sourceHash: string;
  sheetName: string;
  rowNumber: number;
};

export type ImportIssue = {
  code: string;
  severity: 'warning' | 'error';
  source: Pick<SourceRef, 'workbookKind' | 'sourceFileName' | 'sheetName' | 'rowNumber'>;
  message: string;
};

export type StagedRow = {
  entityType: ImportEntityType;
  source: SourceRef;
  fingerprint: string;
  status: ImportRowStatus;
  rawData: Record<string, ScalarCell>;
  normalizedData: Record<string, unknown>;
  issues: string[];
};

export type FacilityCandidate = {
  source: SourceRef;
  fingerprint: string;
  facilityName: string;
  city: string;
  normalizedName: string;
  normalizedCity: string;
  normalizedKey: string;
  displayKey: string;
  facilityType: string;
  autoFillSpecialty: boolean;
  active: boolean;
  legacyStatus: string | null;
  phoneRaw: string | null;
  phoneNormalized: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  issues: string[];
};

export type FacilitySpecialtyCandidate = {
  source: SourceRef;
  fingerprint: string;
  facilityDisplayKey: string;
  normalizedFacilityKey: string;
  specialty: string;
  normalizedSpecialty: string;
  treatmentStatus: TreatmentStatus;
  notes: string | null;
  issues: string[];
};

export type PostalCodeCandidate = {
  source: SourceRef;
  fingerprint: string;
  zipCode: string;
  latitude: number;
  longitude: number;
  issues: string[];
};

export type CallCandidate = {
  source: SourceRef;
  fingerprint: string;
  logicalFingerprint: string;
  callAt: string;
  callerInitials: string | null;
  lob: string | null;
  authorizationNumber: string | null;
  facilityDisplayKey: string;
  normalizedFacilityKey: string;
  specialty: string | null;
  normalizedSpecialty: string | null;
  diagnosisCode: string | null;
  diagnosisDescription: string | null;
  phone: string | null;
  didNotLeaveVm: boolean;
  acceptingNewPatients: AvailabilityStatus;
  canTreatDiagnosis: TreatmentStatus;
  canScheduleWithinFourWeeks: ScheduleStatus;
  bookingOut: string | null;
  notes: string | null;
  specialtyConfirmed: AvailabilityStatus;
  useInFdm: boolean;
  manualCallTimeOverride: string | null;
  weekStart: string;
  duplicateGroupKey: string;
  resultCode:
    | 'unable_to_contact'
    | 'does_not_meet_availability_guidelines'
    | 'meets_availability_guidelines'
    | 'meets_availability_guidelines_urgent';
  resultPhrase: string;
  importedResultPhrase: string | null;
  legacyAnswers: {
    accepting: LegacySemanticStatus;
    diagnosis: LegacySemanticStatus;
    scheduling: LegacySemanticStatus;
    specialty: LegacySemanticStatus;
  };
  issues: string[];
};

export type WorkbookSource = {
  workbookKind: WorkbookKind;
  sourcePath: string;
  sourceFileName: string;
  sourceHash: string;
  sizeBytes: number;
  importerVersion: string;
  sheetsSeen: string[];
  dateSystem: '1900' | '1904';
  schemaVersion: string;
  sheetDetails: Array<{
    name: string;
    hidden: boolean;
    rowsVisited: number;
    hiddenRows: number;
    formulaCells: number;
  }>;
  formulaCells: number;
  hiddenRows: number;
};

export type WorkbookParseCounts = {
  rowsVisited: number;
  scaffoldRowsSkipped: number;
  rejectedRows: number;
  facilities: number;
  facilitySpecialties: number;
  calls: number;
  postalCodes: number;
};

export type ParsedWorkbook = {
  source: WorkbookSource;
  counts: WorkbookParseCounts;
  facilities: FacilityCandidate[];
  facilitySpecialties: FacilitySpecialtyCandidate[];
  calls: CallCandidate[];
  postalCodes: PostalCodeCandidate[];
  stagedRows: StagedRow[];
  issues: ImportIssue[];
};

export type ImportPlanCounts = WorkbookParseCounts & {
  sourceFiles: number;
  uniqueFacilities: number;
  uniqueFacilitySpecialties: number;
  uniqueCalls: number;
  uniquePostalCodes: number;
  exactDuplicateCalls: number;
  possibleCrossWorkbookCallDuplicates: number;
  unresolvedFacilityReferences: number;
  issueWarnings: number;
  issueErrors: number;
};

export type ImportPlan = {
  importerVersion: string;
  generatedAt: string;
  sources: WorkbookSource[];
  counts: ImportPlanCounts;
  facilities: FacilityCandidate[];
  facilitySpecialties: FacilitySpecialtyCandidate[];
  calls: CallCandidate[];
  postalCodes: PostalCodeCandidate[];
  stagedRows: StagedRow[];
  issues: ImportIssue[];
};

export type SafeImportSummary = {
  importerVersion: string;
  generatedAt: string;
  sources: Array<
    Omit<WorkbookSource, 'sourcePath'> & {
      sourcePath: '[redacted-local-path]';
    }
  >;
  counts: ImportPlanCounts;
  issueCounts: Record<string, { severity: 'warning' | 'error'; count: number }>;
  issueSamples: ImportIssue[];
};
