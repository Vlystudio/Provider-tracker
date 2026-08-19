import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  geometry,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'admin',
  'ura_user',
  'report_viewer',
  'auditor',
]);

export const availabilityStatusEnum = pgEnum('availability_status', [
  'yes',
  'no',
  'unknown',
  'not_applicable',
]);

export const treatmentStatusEnum = pgEnum('treatment_status', [
  'yes',
  'no',
  'unknown',
  'unable_to_tell_without_triage',
  'not_applicable',
]);

export const scheduleStatusEnum = pgEnum('schedule_status', [
  'yes',
  'no',
  'unknown',
  'urgent_referral_required',
  'unable_to_tell_without_triage',
  'not_applicable',
]);

export const resultCodeEnum = pgEnum('result_code', [
  'unable_to_contact',
  'does_not_meet_availability_guidelines',
  'meets_availability_guidelines',
  'meets_availability_guidelines_urgent',
]);

export const authorizationStatusEnum = pgEnum('authorization_status', [
  'open',
  'complete',
  'cancelled',
]);

export const dataQualityStatusEnum = pgEnum('data_quality_status', [
  'clean',
  'needs_review',
  'rejected',
]);

export const workbookKindEnum = pgEnum('workbook_kind', ['admin', 'user']);
export const importBatchStatusEnum = pgEnum('import_batch_status', [
  'pending',
  'staged',
  'applied',
  'failed',
]);
export const importRowStatusEnum = pgEnum('import_row_status', [
  'staged',
  'imported',
  'skipped',
  'rejected',
  'duplicate',
]);
export const importEntityTypeEnum = pgEnum('import_entity_type', [
  'facility',
  'facility_specialty',
  'call',
  'authorization',
  'diagnosis',
  'specialty',
  'line_of_business',
  'postal_code',
]);
export const reportSnapshotTypeEnum = pgEnum('report_snapshot_type', [
  'weekly',
  'monthly',
  'all_time',
  'scheduling_trend',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name'),
    email: text('email').notNull(),
    emailVerified: timestamp('email_verified', { withTimezone: true }),
    displayName: text('display_name'),
    image: text('image'),
    initials: text('initials').notNull(),
    role: userRoleEnum('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isServiceAccount: boolean('is_service_account').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    uniqueIndex('users_initials_unique').on(table.initials),
    index('users_role_active_idx').on(table.role, table.isActive),
  ],
);

// Auth.js-compatible tables are defined without coupling the data model to a
// particular provider. The authentication milestone can add the current,
// security-reviewed adapter without changing the database shape.
export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: integer('expires_at'),
    tokenType: text('token_type'),
    scope: text('scope'),
    idToken: text('id_token'),
    sessionState: text('session_state'),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index('accounts_user_id_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId), index('sessions_expires_idx').on(table.expires)],
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token] }),
    uniqueIndex('verification_tokens_token_unique').on(table.token),
  ],
);

export const linesOfBusiness = pgTable('lines_of_business', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const specialties = pgTable(
  'specialties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    canonicalName: text('canonical_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    active: boolean('active').notNull().default(true),
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('specialties_normalized_name_unique').on(table.normalizedName)],
);

export const diagnoses = pgTable(
  'diagnoses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    active: boolean('active').notNull().default(true),
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('diagnoses_code_unique').on(table.code)],
);

export const referralReasons = pgTable(
  'referral_reasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    label: text('label').notNull(),
    normalizedLabel: text('normalized_label').notNull(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('referral_reasons_normalized_label_unique').on(table.normalizedLabel)],
);

export const bookingOutBuckets = pgTable(
  'booking_out_buckets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    lowerBoundDays: integer('lower_bound_days'),
    upperBoundDays: integer('upper_bound_days'),
    rank: integer('rank').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('booking_out_buckets_code_unique').on(table.code),
    check(
      'booking_out_buckets_bounds_check',
      sql`${table.lowerBoundDays} is null or ${table.upperBoundDays} is null or ${table.lowerBoundDays} <= ${table.upperBoundDays}`,
    ),
  ],
);

export const postalCodeCentroids = pgTable(
  'postal_code_centroids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    zipCode: text('zip_code').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    geogPoint: geometry('geog_point', { type: 'point', mode: 'xy', srid: 4326 }),
    source: text('source').notNull().default('workbook'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('postal_code_centroids_zip_unique').on(table.zipCode),
    index('postal_code_centroids_geog_gist').using('gist', table.geogPoint),
    check('postal_code_centroids_lat_check', sql`${table.latitude} between -90 and 90`),
    check('postal_code_centroids_lon_check', sql`${table.longitude} between -180 and 180`),
    check(
      'postal_code_centroids_geog_srid_check',
      sql`${table.geogPoint} is null or ST_SRID(${table.geogPoint}) = 4326`,
    ),
  ],
);

export const facilities = pgTable(
  'facilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityName: text('facility_name').notNull(),
    city: text('city').notNull(),
    normalizedName: text('normalized_name').notNull(),
    normalizedCity: text('normalized_city').notNull(),
    displayKey: text('display_key').notNull(),
    facilityType: text('facility_type').notNull().default('Hospital'),
    autoFillSpecialty: boolean('auto_fill_specialty').notNull().default(false),
    phoneRaw: text('phone_raw'),
    phoneNormalized: text('phone_normalized'),
    postalCode: text('postal_code'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    geogPoint: geometry('geog_point', { type: 'point', mode: 'xy', srid: 4326 }),
    coordinateProvenance: text('coordinate_provenance'),
    active: boolean('active').notNull().default(true),
    dataQualityStatus: dataQualityStatusEnum('data_quality_status').notNull().default('clean'),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>().notNull().default({}),
    optimisticLockVersion: integer('optimistic_lock_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facilities_normalized_name_city_unique').on(table.normalizedName, table.normalizedCity),
    index('facilities_display_key_idx').on(table.displayKey),
    index('facilities_postal_code_idx').on(table.postalCode),
    index('facilities_active_name_idx').on(table.active, table.normalizedName),
    index('facilities_geog_gist').using('gist', table.geogPoint),
    check(
      'facilities_coordinate_pair_check',
      sql`(${table.latitude} is null and ${table.longitude} is null) or (${table.latitude} is not null and ${table.longitude} is not null)`,
    ),
    check(
      'facilities_geog_srid_check',
      sql`${table.geogPoint} is null or ST_SRID(${table.geogPoint}) = 4326`,
    ),
  ],
);

export const authorizations = pgTable(
  'authorizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorizationNumber: text('authorization_number').notNull(),
    lobId: uuid('lob_id').references(() => linesOfBusiness.id, { onDelete: 'set null' }),
    defaultDiagnosisId: uuid('default_diagnosis_id').references(() => diagnoses.id, { onDelete: 'set null' }),
    defaultSpecialtyId: uuid('default_specialty_id').references(() => specialties.id, { onDelete: 'set null' }),
    referralReasonId: uuid('referral_reason_id').references(() => referralReasons.id, { onDelete: 'set null' }),
    referralReasonDetail: text('referral_reason_detail'),
    memberZip: text('member_zip'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    status: authorizationStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('authorizations_number_unique').on(table.authorizationNumber),
    index('authorizations_status_updated_idx').on(table.status, table.updatedAt),
  ],
);

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceFileName: text('source_file_name').notNull(),
    sourceHash: text('source_hash').notNull(),
    sourceSizeBytes: integer('source_size_bytes').notNull(),
    workbookKind: workbookKindEnum('workbook_kind').notNull(),
    importerVersion: text('importer_version').notNull(),
    status: importBatchStatusEnum('status').notNull().default('pending'),
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('import_batches_hash_version_unique').on(table.sourceHash, table.importerVersion),
    index('import_batches_status_created_idx').on(table.status, table.createdAt),
  ],
);

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorizationId: uuid('authorization_id').references(() => authorizations.id, { onDelete: 'set null' }),
    facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'set null' }),
    callerUserId: uuid('caller_user_id').references(() => users.id, { onDelete: 'set null' }),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, { onDelete: 'set null' }),
    callAt: timestamp('call_at', { withTimezone: true }).notNull(),
    callerInitialsSnapshot: text('caller_initials_snapshot'),
    lobSnapshot: text('lob_snapshot'),
    authorizationNumberSnapshot: text('authorization_number_snapshot'),
    facilitySnapshot: text('facility_snapshot').notNull(),
    diagnosisCodeSnapshot: text('diagnosis_code_snapshot'),
    diagnosisDescriptionSnapshot: text('diagnosis_description_snapshot'),
    specialtySnapshot: text('specialty_snapshot'),
    phoneSnapshot: text('phone_snapshot'),
    didNotLeaveVm: boolean('did_not_leave_vm').notNull().default(false),
    acceptingNewPatients: availabilityStatusEnum('accepting_new_patients').notNull().default('unknown'),
    canTreatDiagnosis: treatmentStatusEnum('can_treat_diagnosis').notNull().default('unknown'),
    canScheduleWithinFourWeeks: scheduleStatusEnum('can_schedule_within_four_weeks').notNull().default('unknown'),
    bookingOutRaw: text('booking_out_raw'),
    bookingOutBucketId: uuid('booking_out_bucket_id').references(() => bookingOutBuckets.id, { onDelete: 'set null' }),
    notes: text('notes'),
    referralTypeSnapshot: text('referral_type_snapshot'),
    referralReasonSnapshot: text('referral_reason_snapshot'),
    specialtyConfirmed: availabilityStatusEnum('specialty_confirmed').notNull().default('unknown'),
    useInFdm: boolean('use_in_fdm').notNull().default(false),
    manualCallTimeOverride: timestamp('manual_call_time_override', { withTimezone: true }),
    weekStart: date('week_start'),
    duplicateGroupKey: text('duplicate_group_key'),
    repeatCallReason: text('repeat_call_reason'),
    resultCode: resultCodeEnum('result_code').notNull(),
    resultPhrase: text('result_phrase').notNull(),
    ruleVersion: text('rule_version').notNull().default('v1'),
    importFingerprint: text('import_fingerprint'),
    sourceWorkbook: text('source_workbook'),
    sourceSheet: text('source_sheet'),
    sourceRow: integer('source_row'),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>().notNull().default({}),
    optimisticLockVersion: integer('optimistic_lock_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('calls_import_fingerprint_unique').on(table.importFingerprint),
    index('calls_call_at_idx').on(table.callAt),
    index('calls_facility_call_at_idx').on(table.facilityId, table.callAt),
    index('calls_authorization_call_at_idx').on(table.authorizationId, table.callAt),
    index('calls_fdm_latest_idx').on(
      table.facilityId,
      table.specialtySnapshot,
      table.diagnosisCodeSnapshot,
      table.callAt,
    ),
    index('calls_weekly_duplicate_idx').on(table.facilityId, table.diagnosisCodeSnapshot, table.weekStart),
  ],
);

export const facilitySpecialties = pgTable(
  'facility_specialties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id, { onDelete: 'cascade' }),
    specialtyId: uuid('specialty_id')
      .notNull()
      .references(() => specialties.id, { onDelete: 'cascade' }),
    treatmentStatus: treatmentStatusEnum('treatment_status').notNull().default('unknown'),
    notes: text('notes'),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
    confirmingCallId: uuid('confirming_call_id').references(() => calls.id, { onDelete: 'set null' }),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('facility_specialty_unique_pair').on(table.facilityId, table.specialtyId)],
);

export const importRowResults = pgTable(
  'import_row_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    entityType: importEntityTypeEnum('entity_type').notNull(),
    sheetName: text('sheet_name').notNull(),
    sourceRow: integer('source_row').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: importRowStatusEnum('status').notNull().default('staged'),
    canonicalEntityId: uuid('canonical_entity_id'),
    rawData: jsonb('raw_data').$type<Record<string, unknown>>().notNull().default({}),
    normalizedData: jsonb('normalized_data').$type<Record<string, unknown>>().notNull().default({}),
    issues: jsonb('issues').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('import_row_results_source_unique').on(
      table.batchId,
      table.entityType,
      table.sheetName,
      table.sourceRow,
    ),
    index('import_row_results_fingerprint_idx').on(table.entityType, table.fingerprint),
    index('import_row_results_status_idx').on(table.batchId, table.status),
  ],
);

export const reportSnapshots = pgTable(
  'report_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotType: reportSnapshotTypeEnum('snapshot_type').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    generatedBy: uuid('generated_by').references(() => users.id, { onDelete: 'set null' }),
    ruleVersion: text('rule_version').notNull().default('v1'),
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
    rowCount: integer('row_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('report_snapshots_period_unique').on(table.snapshotType, table.periodStart, table.periodEnd),
    check('report_snapshots_period_check', sql`${table.periodStart} <= ${table.periodEnd}`),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    beforeJson: jsonb('before_json').$type<Record<string, unknown>>(),
    afterJson: jsonb('after_json').$type<Record<string, unknown>>(),
    requestId: text('request_id'),
    sourceIpHash: text('source_ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_entity_idx').on(table.entityType, table.entityId, table.createdAt),
    index('audit_events_actor_created_idx').on(table.actorId, table.createdAt),
  ],
);
