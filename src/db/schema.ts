import { sql } from 'drizzle-orm';
import {
  bigint,
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

export const verificationAnswerEnum = pgEnum('verification_answer', [
  'yes',
  'no',
  'unknown',
  'not_asked',
  'unable_to_verify',
  'not_applicable',
]);

export const verificationMethodEnum = pgEnum('verification_method', [
  'phone',
  'fax',
  'portal',
  'website',
  'email',
  'internal_source',
  'other',
]);

export const sourceConfidenceEnum = pgEnum('source_confidence', [
  'direct',
  'authoritative',
  'secondary',
  'unverified',
]);

export const contactOutcomeEnum = pgEnum('contact_outcome', [
  'verified',
  'no_answer',
  'voicemail_left',
  'voicemail_not_left',
  'disconnected',
  'wrong_number',
  'fax_only',
  'callback_requested',
  'unable_to_verify',
]);

export const coordinateQualityEnum = pgEnum('coordinate_quality', [
  'exact',
  'address',
  'zip_centroid',
  'manual',
  'unknown',
]);

export const duplicateConfidenceEnum = pgEnum('duplicate_confidence', [
  'exact',
  'probable',
  'possible',
]);

export const duplicateDecisionEnum = pgEnum('duplicate_decision', [
  'pending',
  'not_duplicate',
  'deferred',
  'merged',
]);

export const assignmentStatusEnum = pgEnum('assignment_status', [
  'open',
  'completed',
  'dismissed',
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
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    displayName: text('display_name'),
    image: text('image'),
    initials: text('initials').notNull().default('--'),
    role: userRoleEnum('role').notNull().default('ura_user'),
    isActive: boolean('is_active').notNull().default(true),
    isServiceAccount: boolean('is_service_account').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    index('users_role_active_idx').on(table.role, table.isActive),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    issuer: text('issuer').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('accounts_issuer_account_unique').on(table.issuer, table.accountId),
    index('accounts_user_id_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_unique').on(table.token),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_idx').on(table.expiresAt),
  ],
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('verification_tokens_value_unique').on(table.value),
    index('verification_tokens_identifier_idx').on(table.identifier),
  ],
);

export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('auth_rate_limits_key_unique').on(table.key)],
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
    addressLine1: text('address_line_1'),
    addressLine2: text('address_line_2'),
    stateCode: text('state_code'),
    autoFillSpecialty: boolean('auto_fill_specialty').notNull().default(false),
    phoneRaw: text('phone_raw'),
    phoneNormalized: text('phone_normalized'),
    postalCode: text('postal_code'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    geogPoint: geometry('geog_point', { type: 'point', mode: 'xy', srid: 4326 }),
    coordinateProvenance: text('coordinate_provenance'),
    coordinateQuality: coordinateQualityEnum('coordinate_quality').notNull().default('unknown'),
    currentAcceptingStatus: verificationAnswerEnum('current_accepting_status').notNull().default('unknown'),
    currentSchedulingStatus: verificationAnswerEnum('current_scheduling_status').notNull().default('unknown'),
    currentUrgentReferralStatus: verificationAnswerEnum('current_urgent_referral_status').notNull().default('unknown'),
    nextAvailableDate: date('next_available_date'),
    estimatedWaitDays: integer('estimated_wait_days'),
    acceptingVerifiedAt: timestamp('accepting_verified_at', { withTimezone: true }),
    schedulingVerifiedAt: timestamp('scheduling_verified_at', { withTimezone: true }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    addressVerifiedAt: timestamp('address_verified_at', { withTimezone: true }),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    mergedIntoFacilityId: uuid('merged_into_facility_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'set null' }),
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
    index('facilities_verification_queue_idx').on(table.active, table.lastVerifiedAt),
    index('facilities_accepting_freshness_idx').on(table.currentAcceptingStatus, table.acceptingVerifiedAt),
    index('facilities_merged_into_idx').on(table.mergedIntoFacilityId),
    check(
      'facilities_coordinate_pair_check',
      sql`(${table.latitude} is null and ${table.longitude} is null) or (${table.latitude} is not null and ${table.longitude} is not null)`,
    ),
    check(
      'facilities_geog_srid_check',
      sql`${table.geogPoint} is null or ST_SRID(${table.geogPoint}) = 4326`,
    ),
    check('facilities_wait_days_check', sql`${table.estimatedWaitDays} is null or ${table.estimatedWaitDays} >= 0`),
    check('facilities_merge_self_check', sql`${table.mergedIntoFacilityId} is null or ${table.mergedIntoFacilityId} <> ${table.id}`),
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
    verificationStatus: verificationAnswerEnum('verification_status').notNull().default('unknown'),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
    confirmingCallId: uuid('confirming_call_id').references(() => calls.id, { onDelete: 'set null' }),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>().notNull().default({}),
    optimisticLockVersion: integer('optimistic_lock_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facility_specialty_unique_pair').on(table.facilityId, table.specialtyId),
    index('facility_specialties_search_idx').on(table.specialtyId, table.active, table.verificationStatus),
    index('facility_specialties_freshness_idx').on(table.facilityId, table.lastConfirmedAt),
  ],
);

export const facilityDiagnosisCapabilities = pgTable(
  'facility_diagnosis_capabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
    diagnosisId: uuid('diagnosis_id').notNull().references(() => diagnoses.id, { onDelete: 'cascade' }),
    status: verificationAnswerEnum('status').notNull().default('unknown'),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>().notNull().default({}),
    optimisticLockVersion: integer('optimistic_lock_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facility_diagnosis_unique_pair').on(table.facilityId, table.diagnosisId),
    index('facility_diagnosis_search_idx').on(table.diagnosisId, table.active, table.status),
    index('facility_diagnosis_freshness_idx').on(table.facilityId, table.lastVerifiedAt),
  ],
);

export const facilityVerificationEvents = pgTable(
  'facility_verification_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id').notNull().references(() => facilities.id, { onDelete: 'restrict' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
    method: verificationMethodEnum('method').notNull(),
    confidence: sourceConfidenceEnum('confidence').notNull().default('direct'),
    contactPerson: text('contact_person'),
    contactChannel: text('contact_channel'),
    acceptingStatus: verificationAnswerEnum('accepting_status'),
    specialtyId: uuid('specialty_id').references(() => specialties.id, { onDelete: 'set null' }),
    specialtyStatus: verificationAnswerEnum('specialty_status'),
    diagnosisId: uuid('diagnosis_id').references(() => diagnoses.id, { onDelete: 'set null' }),
    diagnosisStatus: verificationAnswerEnum('diagnosis_status'),
    schedulingWithinFourWeeks: verificationAnswerEnum('scheduling_within_four_weeks'),
    urgentReferralStatus: verificationAnswerEnum('urgent_referral_status'),
    nextAvailableDate: date('next_available_date'),
    estimatedWaitDays: integer('estimated_wait_days'),
    comments: text('comments'),
    relatedCallId: uuid('related_call_id').references(() => calls.id, { onDelete: 'set null' }),
    relatedContactAttemptId: uuid('related_contact_attempt_id'),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, { onDelete: 'set null' }),
    previousState: jsonb('previous_state').$type<Record<string, unknown>>().notNull().default({}),
    resultingState: jsonb('resulting_state').$type<Record<string, unknown>>().notNull().default({}),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('facility_verification_history_idx').on(table.facilityId, table.verifiedAt),
    index('facility_verification_user_idx').on(table.verifiedBy, table.verifiedAt),
    index('facility_verification_specialty_idx').on(table.specialtyId, table.verifiedAt),
    index('facility_verification_diagnosis_idx').on(table.diagnosisId, table.verifiedAt),
    check('facility_verification_wait_days_check', sql`${table.estimatedWaitDays} is null or ${table.estimatedWaitDays} >= 0`),
    check(
      'facility_verification_has_fact_check',
      sql`${table.acceptingStatus} is not null or ${table.specialtyStatus} is not null or ${table.diagnosisStatus} is not null or ${table.schedulingWithinFourWeeks} is not null or ${table.urgentReferralStatus} is not null or ${table.nextAvailableDate} is not null or ${table.estimatedWaitDays} is not null or nullif(trim(${table.comments}), '') is not null`,
    ),
  ],
);

export const facilityContactAttempts = pgTable(
  'facility_contact_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id').notNull().references(() => facilities.id, { onDelete: 'restrict' }),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull(),
    attemptedBy: uuid('attempted_by').references(() => users.id, { onDelete: 'set null' }),
    method: verificationMethodEnum('method').notNull(),
    outcome: contactOutcomeEnum('outcome').notNull(),
    contactPerson: text('contact_person'),
    contactChannel: text('contact_channel'),
    comments: text('comments'),
    relatedCallId: uuid('related_call_id').references(() => calls.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('facility_contact_history_idx').on(table.facilityId, table.attemptedAt),
    index('facility_contact_outcome_idx').on(table.outcome, table.attemptedAt),
  ],
);

export const reverificationAssignments = pgTable(
  'reverification_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    status: assignmentStatusEnum('status').notNull().default('open'),
    reasonCodes: jsonb('reason_codes').$type<string[]>().notNull().default([]),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reverification_assignments_one_open').on(table.facilityId).where(sql`${table.status} = 'open'`),
    index('reverification_assignments_assignee_idx').on(table.assignedTo, table.status, table.createdAt),
  ],
);

export const facilityDuplicateCandidates = pgTable(
  'facility_duplicate_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leftFacilityId: uuid('left_facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
    rightFacilityId: uuid('right_facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
    confidence: duplicateConfidenceEnum('confidence').notNull(),
    score: integer('score').notNull(),
    reasonCodes: jsonb('reason_codes').$type<string[]>().notNull().default([]),
    decision: duplicateDecisionEnum('decision').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facility_duplicate_pair_unique').on(table.leftFacilityId, table.rightFacilityId),
    index('facility_duplicate_review_idx').on(table.decision, table.confidence, table.score),
    check('facility_duplicate_order_check', sql`${table.leftFacilityId} < ${table.rightFacilityId}`),
    check('facility_duplicate_score_check', sql`${table.score} between 0 and 100`),
  ],
);

export const facilityMergeRecords = pgTable(
  'facility_merge_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    survivorFacilityId: uuid('survivor_facility_id').notNull().references(() => facilities.id, { onDelete: 'restrict' }),
    mergedFacilityId: uuid('merged_facility_id').notNull().references(() => facilities.id, { onDelete: 'restrict' }),
    candidateId: uuid('candidate_id').references(() => facilityDuplicateCandidates.id, { onDelete: 'set null' }),
    mergedBy: uuid('merged_by').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason').notNull(),
    restoreSnapshot: jsonb('restore_snapshot').$type<Record<string, unknown>>().notNull(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoneBy: uuid('undone_by').references(() => users.id, { onDelete: 'set null' }),
    undoReason: text('undo_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facility_merge_one_active_source').on(table.mergedFacilityId).where(sql`${table.undoneAt} is null`),
    index('facility_merge_survivor_idx').on(table.survivorFacilityId, table.createdAt),
    check('facility_merge_distinct_check', sql`${table.survivorFacilityId} <> ${table.mergedFacilityId}`),
  ],
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
    result: text('result').notNull().default('success'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    beforeJson: jsonb('before_json').$type<Record<string, unknown>>(),
    afterJson: jsonb('after_json').$type<Record<string, unknown>>(),
    requestId: text('request_id'),
    sourceIpHash: text('source_ip_hash'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_entity_idx').on(table.entityType, table.entityId, table.createdAt),
    index('audit_events_actor_created_idx').on(table.actorId, table.createdAt),
  ],
);
