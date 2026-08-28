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
export const migrationRunStatusEnum = pgEnum('migration_run_status', [
  'previewed',
  'approved',
  'running',
  'failed',
  'applied',
  'reconciled',
  'cancelled',
  'reversed',
]);
export const migrationDiagnosticStatusEnum = pgEnum('migration_diagnostic_status', [
  'open',
  'resolved',
  'deferred',
  'skipped',
]);
export const migrationReadinessEnum = pgEnum('migration_readiness', [
  'go',
  'go_with_warnings',
  'no_go',
]);
export const legacyActorStatusEnum = pgEnum('legacy_actor_status', [
  'unmapped',
  'mapped',
  'legacy_only',
  'ambiguous',
]);
export const reportSnapshotTypeEnum = pgEnum('report_snapshot_type', [
  'weekly',
  'monthly',
  'all_time',
  'scheduling_trend',
]);

export const automationResultEnum = pgEnum('automation_result', [
  'running',
  'succeeded',
  'failed',
  'skipped',
  'dry_run',
]);
export const notificationSeverityEnum = pgEnum('notification_severity', [
  'informational',
  'attention',
  'important',
]);
export const digestFrequencyEnum = pgEnum('digest_frequency', ['none', 'daily', 'weekly']);
export const workItemStatusEnum = pgEnum('work_item_status', [
  'open',
  'assigned',
  'in_progress',
  'completed',
  'dismissed',
  'blocked',
]);
export const coverageStateEnum = pgEnum('coverage_state', ['unknown', 'healthy', 'alerting']);
export const accessReviewDecisionEnum = pgEnum('access_review_decision', [
  'retain',
  'modify',
  'disable',
  'investigate',
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
    lastSignedInAt: timestamp('last_signed_in_at', { withTimezone: true }),
    roleAssignedAt: timestamp('role_assigned_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    index('users_role_active_idx').on(table.role, table.isActive),
    index('users_last_signed_in_idx').on(table.lastSignedInAt),
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
    migrationBaselineAt: timestamp('migration_baseline_at', { withTimezone: true }),
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
    migrationRunId: uuid('migration_run_id').references(() => migrationRuns.id, { onDelete: 'set null' }),
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

export const migrationRuns = pgTable(
  'migration_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importerVersion: text('importer_version').notNull(),
    status: migrationRunStatusEnum('status').notNull().default('previewed'),
    releaseVersion: text('release_version').notNull(),
    sourceManifest: jsonb('source_manifest').$type<Record<string, unknown>>().notNull().default({}),
    previewCounts: jsonb('preview_counts').$type<Record<string, number>>().notNull().default({}),
    applyCounts: jsonb('apply_counts').$type<Record<string, unknown>>().notNull().default({}),
    reconciliation: jsonb('reconciliation').$type<Record<string, unknown>>().notNull().default({}),
    readiness: migrationReadinessEnum('readiness').notNull().default('no_go'),
    notificationBaselineAt: timestamp('notification_baseline_at', { withTimezone: true }),
    previewedBy: uuid('previewed_by').references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    executedBy: uuid('executed_by').references(() => users.id, { onDelete: 'set null' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'set null' }),
    failureCategory: text('failure_category'),
    failureMessage: text('failure_message'),
    approvalReason: text('approval_reason'),
    reversalReason: text('reversal_reason'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('migration_runs_status_created_idx').on(table.status, table.createdAt),
    index('migration_runs_readiness_created_idx').on(table.readiness, table.createdAt),
  ],
);

export const migrationSources = pgTable(
  'migration_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    migrationRunId: uuid('migration_run_id').notNull().references(() => migrationRuns.id, { onDelete: 'cascade' }),
    workbookKind: workbookKindEnum('workbook_kind').notNull(),
    sourceFileName: text('source_file_name').notNull(),
    sourceHash: text('source_hash').notNull(),
    sourceSizeBytes: integer('source_size_bytes').notNull(),
    schemaVersion: text('schema_version').notNull(),
    sheets: jsonb('sheets').$type<Array<Record<string, unknown>>>().notNull().default([]),
    rowsScanned: integer('rows_scanned').notNull().default(0),
    formulaCells: integer('formula_cells').notNull().default(0),
    hiddenRows: integer('hidden_rows').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('migration_sources_run_hash_unique').on(table.migrationRunId, table.sourceHash),
    index('migration_sources_hash_idx').on(table.sourceHash),
    check('migration_sources_size_check', sql`${table.sourceSizeBytes} >= 0 and ${table.rowsScanned} >= 0 and ${table.formulaCells} >= 0 and ${table.hiddenRows} >= 0`),
  ],
);

export const migrationDiagnostics = pgTable(
  'migration_diagnostics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    migrationRunId: uuid('migration_run_id').notNull().references(() => migrationRuns.id, { onDelete: 'cascade' }),
    sourceHash: text('source_hash').notNull(),
    workbookKind: workbookKindEnum('workbook_kind').notNull(),
    entityType: text('entity_type').notNull(),
    sheetName: text('sheet_name').notNull(),
    sourceRow: integer('source_row').notNull(),
    rowKey: text('row_key'),
    issueCode: text('issue_code').notNull(),
    severity: text('severity').notNull(),
    message: text('message').notNull(),
    suggestedAction: text('suggested_action'),
    status: migrationDiagnosticStatusEnum('status').notNull().default('open'),
    resolutionAction: text('resolution_action'),
    targetEntityId: uuid('target_entity_id'),
    resolutionNote: text('resolution_note'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    optimisticLockVersion: integer('optimistic_lock_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('migration_diagnostics_source_issue_unique').on(
      table.migrationRunId,
      table.sourceHash,
      table.entityType,
      table.sheetName,
      table.sourceRow,
      table.issueCode,
    ),
    index('migration_diagnostics_run_status_idx').on(table.migrationRunId, table.status, table.severity),
    check('migration_diagnostics_source_row_check', sql`${table.sourceRow} >= 0`),
    check('migration_diagnostics_severity_check', sql`${table.severity} in ('warning','error')`),
    check('migration_diagnostics_resolution_check', sql`${table.resolutionAction} is null or ${table.resolutionAction} in ('use_existing','create_new','skip','defer')`),
  ],
);

export const legacyActors = pgTable(
  'legacy_actors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    normalizedKey: text('normalized_key').notNull(),
    initials: text('initials'),
    displayName: text('display_name'),
    status: legacyActorStatusEnum('status').notNull().default('unmapped'),
    mappedUserId: uuid('mapped_user_id').references(() => users.id, { onDelete: 'set null' }),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>().notNull().default({}),
    mappedBy: uuid('mapped_by').references(() => users.id, { onDelete: 'set null' }),
    mappedAt: timestamp('mapped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('legacy_actors_normalized_key_unique').on(table.normalizedKey)],
);

export const legacyValueMappings = pgTable(
  'legacy_value_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mappingType: text('mapping_type').notNull(),
    sourceValue: text('source_value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    targetEntityId: uuid('target_entity_id'),
    decision: text('decision').notNull().default('mapped'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('legacy_value_mappings_type_value_unique').on(table.mappingType, table.normalizedValue),
    check('legacy_value_mappings_type_check', sql`${table.mappingType} in ('specialty','diagnosis','actor')`),
    check('legacy_value_mappings_decision_check', sql`${table.decision} in ('mapped','skip')`),
  ],
);

export const migrationReconciliations = pgTable(
  'migration_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    migrationRunId: uuid('migration_run_id').notNull().references(() => migrationRuns.id, { onDelete: 'cascade' }),
    sourceRows: integer('source_rows').notNull(),
    reconciledRows: integer('reconciled_rows').notNull(),
    importedRows: integer('imported_rows').notNull().default(0),
    updatedRows: integer('updated_rows').notNull().default(0),
    unchangedRows: integer('unchanged_rows').notNull().default(0),
    skippedRows: integer('skipped_rows').notNull().default(0),
    conflictRows: integer('conflict_rows').notNull().default(0),
    invalidRows: integer('invalid_rows').notNull().default(0),
    reconciliationPercent: doublePrecision('reconciliation_percent').notNull(),
    relationshipCounts: jsonb('relationship_counts').$type<Record<string, number>>().notNull().default({}),
    stateDistribution: jsonb('state_distribution').$type<Record<string, number>>().notNull().default({}),
    reportComparison: jsonb('report_comparison').$type<Record<string, unknown>>().notNull().default({}),
    discrepancies: jsonb('discrepancies').$type<Array<Record<string, unknown>>>().notNull().default([]),
    readiness: migrationReadinessEnum('readiness').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('migration_reconciliations_run_unique').on(table.migrationRunId),
    check('migration_reconciliations_percent_check', sql`${table.reconciliationPercent} between 0 and 100`),
    check('migration_reconciliations_rows_check', sql`${table.reconciledRows} <= ${table.sourceRows}`),
    check('migration_reconciliations_accounting_check', sql`${table.reconciledRows} = ${table.importedRows} + ${table.updatedRows} + ${table.unchangedRows} + ${table.skippedRows} + ${table.conflictRows} + ${table.invalidRows}`),
  ],
);

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorizationId: uuid('authorization_id').references(() => authorizations.id, { onDelete: 'set null' }),
    facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'set null' }),
    callerUserId: uuid('caller_user_id').references(() => users.id, { onDelete: 'set null' }),
    legacyActorId: uuid('legacy_actor_id').references(() => legacyActors.id, { onDelete: 'set null' }),
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
    legacyActorId: uuid('legacy_actor_id').references(() => legacyActors.id, { onDelete: 'set null' }),
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
    legacyActorId: uuid('legacy_actor_id').references(() => legacyActors.id, { onDelete: 'set null' }),
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

export const accessReviewDecisions = pgTable(
  'access_review_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewPeriod: text('review_period').notNull(),
    reviewedUserId: uuid('reviewed_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedRole: userRoleEnum('reviewed_role').notNull(),
    accountActive: boolean('account_active').notNull(),
    lastSignedInAt: timestamp('last_signed_in_at', { withTimezone: true }),
    decision: accessReviewDecisionEnum('decision').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('access_review_period_user_reviewer_unique').on(
      table.reviewPeriod,
      table.reviewedUserId,
      table.reviewerId,
    ),
    index('access_review_user_decided_idx').on(table.reviewedUserId, table.decidedAt),
    index('access_review_period_decided_idx').on(table.reviewPeriod, table.decidedAt),
    check('access_review_period_check', sql`${table.reviewPeriod} ~ '^[0-9]{4}-Q[1-4]$'`),
  ],
);

export const dataRetentionPolicies = pgTable(
  'data_retention_policies',
  {
    category: text('category').primaryKey(),
    retentionDays: integer('retention_days'),
    deletionEnabled: boolean('deletion_enabled').notNull().default(false),
    policyReference: text('policy_reference'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('data_retention_category_check', sql`char_length(${table.category}) between 2 and 80 and ${table.category} ~ '^[a-z][a-z0-9_]*$'`),
    check('data_retention_days_check', sql`${table.retentionDays} is null or ${table.retentionDays} between 1 and 36500`),
    check('data_retention_policy_reference_check', sql`${table.policyReference} is null or char_length(${table.policyReference}) between 3 and 200`),
    check(
      'data_retention_deletion_approval_check',
      sql`not ${table.deletionEnabled} or (${table.retentionDays} is not null and ${table.policyReference} is not null and ${table.approvedBy} is not null and ${table.approvedAt} is not null)`,
    ),
  ],
);

export const dataRetentionHolds = pgTable(
  'data_retention_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category: text('category').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    reasonCode: text('reason_code').notNull(),
    placedBy: uuid('placed_by').references(() => users.id, { onDelete: 'set null' }),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    releasedBy: uuid('released_by').references(() => users.id, { onDelete: 'set null' }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    index('data_retention_hold_category_active_idx').on(table.category, table.releasedAt),
    index('data_retention_hold_entity_idx').on(table.entityType, table.entityId, table.releasedAt),
    check('data_retention_hold_category_check', sql`char_length(${table.category}) between 2 and 80 and ${table.category} ~ '^[a-z][a-z0-9_]*$'`),
    check('data_retention_hold_reason_check', sql`char_length(${table.reasonCode}) between 2 and 80 and ${table.reasonCode} ~ '^[a-z][a-z0-9_]*$'`),
    check(
      'data_retention_hold_entity_pair_check',
      sql`(${table.entityType} is null and ${table.entityId} is null) or (${table.entityType} is not null and ${table.entityId} is not null)`,
    ),
    check(
      'data_retention_hold_release_pair_check',
      sql`(${table.releasedBy} is null and ${table.releasedAt} is null) or (${table.releasedBy} is not null and ${table.releasedAt} is not null)`,
    ),
  ],
);

export const automationJobExecutions = pgTable(
  'automation_job_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionKey: text('execution_key').notNull(),
    jobType: text('job_type').notNull(),
    trigger: text('trigger').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    result: automationResultEnum('result').notNull().default('running'),
    processedCount: integer('processed_count').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    retryCount: integer('retry_count').notNull().default(0),
    releaseVersion: text('release_version').notNull(),
    errorCategory: text('error_category'),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('automation_job_execution_key_unique').on(table.executionKey),
    index('automation_job_type_started_idx').on(table.jobType, table.startedAt),
    index('automation_job_result_started_idx').on(table.result, table.startedAt),
  ],
);

export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  inAppEnabled: boolean('in_app_enabled').notNull().default(true),
  digestFrequency: digestFrequencyEnum('digest_frequency').notNull().default('daily'),
  categories: jsonb('categories').$type<string[]>().notNull().default(['work', 'changes', 'coverage', 'digest']),
  minimumSeverity: notificationSeverityEnum('minimum_severity').notNull().default('informational'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    category: text('category').notNull(),
    severity: notificationSeverityEnum('severity').notNull().default('informational'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    targetPath: text('target_path'),
    source: text('source').notNull(),
    deduplicationKey: text('deduplication_key').notNull(),
    issueKey: text('issue_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notifications_recipient_dedup_unique').on(table.recipientId, table.deduplicationKey),
    index('notifications_recipient_read_idx').on(table.recipientId, table.readAt, table.createdAt),
    check('notifications_target_path_check', sql`${table.targetPath} is null or (
      char_length(${table.targetPath}) <= 512
      and left(${table.targetPath}, 1) = '/'
      and left(${table.targetPath}, 2) <> '//'
      and position(chr(92) in ${table.targetPath}) = 0
      and ${table.targetPath} !~ '[[:cntrl:]]'
    )`),
  ],
);

export const operationalWorkItems = pgTable(
  'operational_work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workType: text('work_type').notNull(),
    priority: notificationSeverityEnum('priority').notNull().default('attention'),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    reasonCodes: jsonb('reason_codes').$type<string[]>().notNull().default([]),
    status: workItemStatusEnum('status').notNull().default('open'),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    source: text('source').notNull(),
    deduplicationKey: text('deduplication_key').notNull(),
    cycle: integer('cycle').notNull().default(1),
    blockedReason: text('blocked_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: uuid('dismissed_by').references(() => users.id, { onDelete: 'set null' }),
    dismissalReason: text('dismissal_reason'),
    optimisticLockVersion: integer('optimistic_lock_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('operational_work_dedup_unique').on(table.deduplicationKey),
    index('operational_work_assignee_status_idx').on(table.assignedTo, table.status, table.dueAt),
    index('operational_work_type_status_idx').on(table.workType, table.status, table.dueAt),
    check('operational_work_cycle_check', sql`${table.cycle} >= 1`),
  ],
);

export const operationalChangeEvents = pgTable(
  'operational_change_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    severity: notificationSeverityEnum('severity').notNull().default('informational'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    deduplicationKey: text('deduplication_key').notNull(),
    beforeValue: jsonb('before_value').$type<Record<string, unknown>>(),
    afterValue: jsonb('after_value').$type<Record<string, unknown>>(),
    specialtyId: uuid('specialty_id').references(() => specialties.id, { onDelete: 'set null' }),
    diagnosisId: uuid('diagnosis_id').references(() => diagnoses.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('operational_change_dedup_unique').on(table.deduplicationKey),
    index('operational_change_occurred_idx').on(table.occurredAt, table.eventType),
    index('operational_change_facility_idx').on(table.facilityId, table.occurredAt),
  ],
);

export const coverageWatches = pgTable(
  'coverage_watches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    specialtyId: uuid('specialty_id').references(() => specialties.id, { onDelete: 'restrict' }),
    diagnosisId: uuid('diagnosis_id').references(() => diagnoses.id, { onDelete: 'restrict' }),
    postalCode: text('postal_code').notNull(),
    radiusMiles: integer('radius_miles').notNull(),
    minimumCount: integer('minimum_count').notNull(),
    freshnessDays: integer('freshness_days').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    state: coverageStateEnum('state').notNull().default('unknown'),
    cycle: integer('cycle').notNull().default(0),
    lastCount: integer('last_count'),
    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('coverage_watches_enabled_idx').on(table.enabled, table.lastEvaluatedAt),
    check('coverage_watches_radius_check', sql`${table.radiusMiles} in (10,25,50,100)`),
    check('coverage_watches_minimum_check', sql`${table.minimumCount} between 1 and 100`),
    check('coverage_watches_freshness_check', sql`${table.freshnessDays} between 1 and 365`),
    check('coverage_watches_filter_check', sql`${table.specialtyId} is not null or ${table.diagnosisId} is not null`),
  ],
);

export const coverageAlertEvents = pgTable(
  'coverage_alert_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    watchId: uuid('watch_id').notNull().references(() => coverageWatches.id, { onDelete: 'cascade' }),
    cycle: integer('cycle').notNull(),
    state: text('state').notNull(),
    observedCount: integer('observed_count').notNull(),
    thresholdCount: integer('threshold_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coverage_alert_cycle_state_unique').on(table.watchId, table.cycle, table.state),
    index('coverage_alert_watch_created_idx').on(table.watchId, table.createdAt),
    check('coverage_alert_state_check', sql`${table.state} in ('opened','resolved')`),
  ],
);

export const operationalDigests = pgTable(
  'operational_digests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    digestType: text('digest_type').notNull(),
    audienceKey: text('audience_key').notNull(),
    recipientId: uuid('recipient_id').references(() => users.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    sourceVersion: text('source_version').notNull(),
    sections: jsonb('sections').$type<Array<{ key: string; label: string; count: number }>>().notNull().default([]),
    executionId: uuid('execution_id').references(() => automationJobExecutions.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('operational_digest_period_unique').on(table.digestType, table.audienceKey, table.periodStart, table.periodEnd),
    index('operational_digest_recipient_idx').on(table.recipientId, table.generatedAt),
    check('operational_digest_period_check', sql`${table.periodStart} < ${table.periodEnd}`),
  ],
);

export const automationSettings = pgTable('automation_settings', {
  scope: text('scope').primaryKey().default('global'),
  timeZone: text('time_zone').notNull().default('America/New_York'),
  upcomingStaleDays: integer('upcoming_stale_days').notNull().default(7),
  meaningfulWaitIncreaseDays: integer('meaningful_wait_increase_days').notNull().default(14),
  meaningfulWaitIncreasePercent: integer('meaningful_wait_increase_percent').notNull().default(50),
  highPriorityEscalationDays: integer('high_priority_escalation_days').notNull().default(3),
  dailyDigestHour: integer('daily_digest_hour').notNull().default(7),
  weeklyDigestDay: integer('weekly_digest_day').notNull().default(1),
  batchSize: integer('batch_size').notNull().default(500),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('automation_settings_scope_check', sql`${table.scope} = 'global'`),
  check('automation_settings_upcoming_check', sql`${table.upcomingStaleDays} between 0 and 30`),
  check('automation_settings_wait_days_check', sql`${table.meaningfulWaitIncreaseDays} between 1 and 180`),
  check('automation_settings_wait_percent_check', sql`${table.meaningfulWaitIncreasePercent} between 1 and 500`),
  check('automation_settings_escalation_check', sql`${table.highPriorityEscalationDays} between 1 and 30`),
  check('automation_settings_daily_hour_check', sql`${table.dailyDigestHour} between 0 and 23`),
  check('automation_settings_weekly_day_check', sql`${table.weeklyDigestDay} between 1 and 7`),
  check('automation_settings_batch_check', sql`${table.batchSize} between 50 and 2000`),
]);
