import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  auditEvents,
  authorizations,
  calls,
  diagnoses,
  facilities,
  facilityContactAttempts,
  facilityDiagnosisCapabilities,
  facilitySpecialties,
  facilityVerificationEvents,
  linesOfBusiness,
  specialties,
  users,
} from '@/db/schema';
import { deriveResult, stableHash, weekStartForDate } from '@/lib/import/normalization';
import { formatTrackingId } from '@/lib/tracking-id';
import { assertPermission, type Principal } from './authorization';
import { buildAuditEvent } from './audit';
import { getDatabasePool, requireDatabaseClient } from './database';

const availabilityStatuses = ['yes', 'no', 'unknown', 'not_applicable'] as const;
const treatmentStatuses = ['yes', 'no', 'unknown', 'unable_to_tell_without_triage', 'not_applicable'] as const;
const scheduleStatuses = ['yes', 'no', 'unknown', 'urgent_referral_required', 'unable_to_tell_without_triage', 'not_applicable'] as const;
const contactOutcomes = [
  'reached',
  'no_answer',
  'voicemail_left',
  'voicemail_not_left',
  'disconnected',
  'wrong_number',
  'fax_only',
  'callback_requested',
  'unable_to_verify',
] as const;

const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable().optional()
  .transform((value) => value || null);

export const callEntryInputSchema = z.object({
  callAt: z.coerce.date(),
  facilityId: z.string().uuid(),
  authorizationId: z.string().uuid().nullable().optional().transform((value) => value || null),
  lobId: z.string().uuid().nullable().optional().transform((value) => value || null),
  specialtyId: z.string().uuid().nullable().optional().transform((value) => value || null),
  diagnosisId: z.string().uuid().nullable().optional().transform((value) => value || null),
  phone: optionalText(40),
  contactOutcome: z.enum(contactOutcomes),
  acceptingNewPatients: z.enum(availabilityStatuses).default('unknown'),
  canTreatDiagnosis: z.enum(treatmentStatuses).default('unknown'),
  canScheduleWithinFourWeeks: z.enum(scheduleStatuses).default('unknown'),
  nextAvailableDate: z.string().date().nullable().optional(),
  estimatedWaitDays: z.number().int().min(0).max(3650).nullable().optional(),
  notes: optionalText(2000),
  specialtyConfirmed: z.enum(availabilityStatuses).default('unknown'),
}).strict().superRefine((value, context) => {
  if (value.callAt.valueOf() > Date.now() + 5 * 60_000) {
    context.addIssue({ code: 'custom', path: ['callAt'], message: 'Call time cannot be in the future.' });
  }
  if (value.callAt.getUTCFullYear() < 2000) {
    context.addIssue({ code: 'custom', path: ['callAt'], message: 'Call time is outside the supported range.' });
  }
  if (value.contactOutcome !== 'reached' && (
    value.nextAvailableDate
    || (value.estimatedWaitDays !== null && value.estimatedWaitDays !== undefined)
  )) {
    context.addIssue({ code: 'custom', path: ['contactOutcome'], message: 'Booking availability can only be recorded after reaching the facility.' });
  }
  if (value.nextAvailableDate && value.nextAvailableDate < value.callAt.toISOString().slice(0, 10)) {
    context.addIssue({ code: 'custom', path: ['nextAvailableDate'], message: 'The next available date cannot be before the call date.' });
  }
  const moreThanFourWeeks = (value.estimatedWaitDays ?? 0) > 28
    || Boolean(value.nextAvailableDate && new Date(`${value.nextAvailableDate}T00:00:00.000Z`).valueOf() > value.callAt.valueOf() + 28 * 86_400_000);
  if (value.canScheduleWithinFourWeeks === 'yes' && moreThanFourWeeks) {
    context.addIssue({ code: 'custom', path: ['canScheduleWithinFourWeeks'], message: 'A wait beyond four weeks cannot be marked as scheduling within four weeks.' });
  }
});

export type CallEntryInput = z.infer<typeof callEntryInputSchema>;

export type CallEntryOption = { id: string; label: string; phone?: string | null };

export type CallLogRow = {
  id: string;
  trackingGroupKey: string;
  trackingId: string;
  provider: string;
  outcome: string;
  status: 'Complete' | 'Follow-up';
  date: string;
  calledAt: string;
  caller: string;
  nextAvailableDate?: string | null;
  estimatedWaitDays?: number | null;
};

export const callLogStatuses = ['Complete', 'Follow-up'] as const;

export const callLogInputSchema = z.object({
  query: z.string().trim().max(200).optional().transform((value) => value || undefined),
  status: z.enum(callLogStatuses).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  sort: z.enum(['date_desc', 'date_asc', 'provider']).default('date_desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, {
  path: ['from'],
  message: 'The start date must be on or before the end date.',
});

export type CallLogInput = z.input<typeof callLogInputSchema>;

export type CallLogPage = {
  rows: CallLogRow[];
  totalCalls: number;
  totalGroups: number;
  page: number;
  pageSize: number;
};

export class CallRecordNotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'The selected record was not found.') {
    super(message);
  }
}

function verificationAnswer(value: string): 'yes' | 'no' | 'unknown' | 'not_applicable' | 'unable_to_verify' {
  if (value === 'yes' || value === 'no' || value === 'not_applicable') return value;
  if (value === 'unable_to_tell_without_triage') return 'unable_to_verify';
  return 'unknown';
}

function schedulingAnswer(value: string) {
  return value === 'urgent_referral_required' ? ('yes' as const) : verificationAnswer(value);
}

function inferredSchedulingStatus(value: CallEntryInput): CallEntryInput['canScheduleWithinFourWeeks'] {
  if (value.canScheduleWithinFourWeeks !== 'unknown') return value.canScheduleWithinFourWeeks;
  const dateIsBeyondFourWeeks = Boolean(value.nextAvailableDate
    && new Date(`${value.nextAvailableDate}T00:00:00.000Z`).valueOf() > value.callAt.valueOf() + 28 * 86_400_000);
  return (value.estimatedWaitDays ?? 0) > 28 || dateIsBeyondFourWeeks ? 'no' : value.canScheduleWithinFourWeeks;
}

function isConfirmed(value: string) {
  return value === 'yes' || value === 'no' || value === 'not_applicable';
}

const failedContactPhrases: Record<Exclude<CallEntryInput['contactOutcome'], 'reached'>, string> = {
  no_answer: 'unable to contact - no answer',
  voicemail_left: 'unable to contact - voicemail left',
  voicemail_not_left: 'unable to contact - voicemail not left',
  disconnected: 'unable to contact - disconnected number',
  wrong_number: 'unable to contact - wrong number',
  fax_only: 'unable to contact - fax line only',
  callback_requested: 'callback requested',
  unable_to_verify: 'unable to verify',
};

export async function getCallEntryOptions(principal: Principal) {
  assertPermission(principal, 'operations:write');
  const db = requireDatabaseClient();
  const [facilityRows, specialtyRows, diagnosisRows, lobRows] = await Promise.all([
    db.select({
      id: facilities.id,
      name: facilities.facilityName,
      city: facilities.city,
      phone: facilities.phoneRaw,
    }).from(facilities)
      .where(and(eq(facilities.active, true), sql`${facilities.mergedIntoFacilityId} is null`))
      .orderBy(asc(facilities.facilityName), asc(facilities.city)),
    db.select({ id: specialties.id, label: specialties.canonicalName }).from(specialties)
      .where(eq(specialties.active, true)).orderBy(asc(specialties.canonicalName)),
    db.select({ id: diagnoses.id, code: diagnoses.code, description: diagnoses.description }).from(diagnoses)
      .where(eq(diagnoses.active, true)).orderBy(asc(diagnoses.code)),
    db.select({ id: linesOfBusiness.id, code: linesOfBusiness.code, label: linesOfBusiness.label }).from(linesOfBusiness)
      .where(eq(linesOfBusiness.isActive, true)).orderBy(asc(linesOfBusiness.sortOrder), asc(linesOfBusiness.code)),
  ]);

  return {
    facilities: facilityRows.map((facility) => ({
      id: facility.id,
      label: `${facility.name} — ${facility.city}`,
      phone: facility.phone,
    })),
    specialties: specialtyRows,
    diagnoses: diagnosisRows.map((diagnosis) => ({
      id: diagnosis.id,
      label: `${diagnosis.code} — ${diagnosis.description}`,
    })),
    linesOfBusiness: lobRows.map((lob) => ({
      id: lob.id,
      label: lob.code === lob.label ? lob.code : `${lob.code} — ${lob.label}`,
    })),
  };
}

type CallLogDatabaseRow = {
  id: string;
  tracking_group_key: string;
  authorization_id: string | null;
  facility: string;
  result_code: string;
  result_phrase: string;
  call_at: Date;
  caller_name: string;
  next_available_date: string | Date | null;
  estimated_wait_days: number | null;
};

type CallLogCountRow = {
  total_calls: string;
  total_groups: string;
};

export async function listCallLog(
  principal: Principal,
  input: CallLogInput = {},
): Promise<CallLogPage> {
  assertPermission(principal, 'operations:read');
  const value = callLogInputSchema.parse(input);
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database configuration is required for the call log.');

  const groupOrderSql = value.sort === 'provider'
    ? 'group_provider ASC, latest_call_at DESC, tracking_group_key'
    : value.sort === 'date_asc'
      ? 'earliest_call_at ASC, tracking_group_key'
      : 'latest_call_at DESC, tracking_group_key';
  const callOrderSql = value.sort === 'provider'
    ? 'fc.facility ASC, fc.call_at DESC, fc.id'
    : value.sort === 'date_asc'
      ? 'fc.call_at ASC, fc.id'
      : 'fc.call_at DESC, fc.id';
  const parameters = [
    value.query ? `%${value.query}%` : null,
    value.status ?? null,
    value.from ?? null,
    value.to ?? null,
  ];
  const baseCallsSql = `
    SELECT
      c.id,
      CASE
        WHEN a.id IS NULL THEN 'call:' || c.id::text
        ELSE 'tracking:' || a.id::text
      END AS tracking_group_key,
      a.id::text AS authorization_id,
      c.facility_snapshot AS facility,
      c.result_code::text AS result_code,
      c.result_phrase,
      c.call_at,
      COALESCE(u.display_name, u.name, c.caller_initials_snapshot, 'Not recorded') AS caller_name,
      c.lob_snapshot,
      c.specialty_snapshot,
      c.diagnosis_code_snapshot,
      c.diagnosis_description_snapshot
    FROM calls c
    LEFT JOIN authorizations a ON a.id = c.authorization_id
    LEFT JOIN users u ON u.id = c.caller_user_id`;
  const callFiltersSql = `
    ($1::text IS NULL OR concat_ws(' ',
        CASE WHEN bc.authorization_id IS NULL THEN NULL ELSE 'PT-' || upper(bc.authorization_id) END,
        bc.facility,
        bc.result_phrase,
        bc.lob_snapshot,
        bc.specialty_snapshot,
        bc.diagnosis_code_snapshot,
        bc.diagnosis_description_snapshot,
        bc.caller_name
      ) ILIKE $1)
      AND ($2::text IS NULL OR CASE
        WHEN bc.result_code = 'unable_to_contact' THEN 'Follow-up'
        ELSE 'Complete'
      END = $2)
      AND ($3::date IS NULL OR bc.call_at >= $3::date)
      AND ($4::date IS NULL OR bc.call_at < $4::date + interval '1 day')`;

  const [countResult, rowResult] = await Promise.all([
    pool.query<CallLogCountRow>(`
      WITH base_calls AS (${baseCallsSql}),
      matched_group_keys AS (
        SELECT DISTINCT bc.tracking_group_key
        FROM base_calls bc
        WHERE ${callFiltersSql}
      )
      SELECT
        count(*)::text AS total_calls,
        count(DISTINCT bc.tracking_group_key)::text AS total_groups
      FROM base_calls bc
      JOIN matched_group_keys mg ON mg.tracking_group_key = bc.tracking_group_key`, parameters),
    pool.query<CallLogDatabaseRow>(`
      WITH base_calls AS (${baseCallsSql}),
      ranked_groups AS (
        SELECT
          bc.tracking_group_key,
          min(bc.call_at) AS earliest_call_at,
          max(bc.call_at) AS latest_call_at,
          min(bc.facility) AS group_provider
        FROM base_calls bc
        WHERE ${callFiltersSql}
        GROUP BY bc.tracking_group_key
      ),
      paged_groups AS (
        SELECT
          tracking_group_key,
          row_number() OVER (ORDER BY ${groupOrderSql}) AS group_position
        FROM ranked_groups
        ORDER BY ${groupOrderSql}
        LIMIT $5 OFFSET $6
      )
      SELECT
        fc.id,
        fc.tracking_group_key,
        fc.authorization_id,
        fc.facility,
        fc.result_code,
        fc.result_phrase,
        fc.call_at,
        fc.caller_name,
        verification.next_available_date,
        verification.estimated_wait_days
      FROM paged_groups pg
      JOIN base_calls fc ON fc.tracking_group_key = pg.tracking_group_key
      LEFT JOIN LATERAL (
        SELECT e.next_available_date, e.estimated_wait_days
        FROM facility_verification_events e
        WHERE e.related_call_id = fc.id
        ORDER BY e.verified_at DESC, e.id DESC
        LIMIT 1
      ) verification ON true
      ORDER BY pg.group_position, ${callOrderSql}`, [
      ...parameters,
      value.pageSize,
      (value.page - 1) * value.pageSize,
    ]),
  ]);
  const counts = countResult.rows[0];

  return {
    rows: rowResult.rows.map((row) => ({
      id: row.id,
      trackingGroupKey: row.tracking_group_key,
      trackingId: row.authorization_id ? formatTrackingId(row.authorization_id) : 'Not recorded',
      provider: row.facility,
      outcome: row.result_phrase,
      status: row.result_code === 'unable_to_contact' ? 'Follow-up' : 'Complete',
      date: row.call_at.toISOString().slice(0, 10),
      calledAt: row.call_at.toISOString(),
      caller: row.caller_name,
      nextAvailableDate: row.next_available_date
        ? new Date(row.next_available_date).toISOString().slice(0, 10)
        : null,
      estimatedWaitDays: row.estimated_wait_days ?? null,
    })),
    totalCalls: Number(counts?.total_calls ?? 0),
    totalGroups: Number(counts?.total_groups ?? 0),
    page: value.page,
    pageSize: value.pageSize,
  };
}

export async function createCallRecord(
  principal: Principal,
  input: CallEntryInput,
  request?: Request,
) {
  assertPermission(principal, 'operations:write');
  const value = callEntryInputSchema.parse(input);
  const db = requireDatabaseClient();

  return db.transaction(async (tx) => {
    const [facility] = await tx.select().from(facilities)
      .where(and(eq(facilities.id, value.facilityId), eq(facilities.active, true), sql`${facilities.mergedIntoFacilityId} is null`))
      .limit(1);
    if (!facility) throw new CallRecordNotFoundError('The selected active facility was not found.');

    const [caller] = await tx.select({ initials: users.initials }).from(users).where(eq(users.id, principal.id)).limit(1);
    const [specialty] = value.specialtyId
      ? await tx.select({ id: specialties.id, name: specialties.canonicalName }).from(specialties)
          .where(and(eq(specialties.id, value.specialtyId), eq(specialties.active, true))).limit(1)
      : [];
    if (value.specialtyId && !specialty) throw new CallRecordNotFoundError('The selected specialty was not found.');

    const [diagnosis] = value.diagnosisId
      ? await tx.select({ id: diagnoses.id, code: diagnoses.code, description: diagnoses.description }).from(diagnoses)
          .where(and(eq(diagnoses.id, value.diagnosisId), eq(diagnoses.active, true))).limit(1)
      : [];
    if (value.diagnosisId && !diagnosis) throw new CallRecordNotFoundError('The selected diagnosis was not found.');

    const [lob] = value.lobId
      ? await tx.select({ id: linesOfBusiness.id, code: linesOfBusiness.code }).from(linesOfBusiness)
          .where(and(eq(linesOfBusiness.id, value.lobId), eq(linesOfBusiness.isActive, true))).limit(1)
      : [];
    if (value.lobId && !lob) throw new CallRecordNotFoundError('The selected line of business was not found.');

    let authorizationId = value.authorizationId;
    let createdAuthorization = false;
    if (authorizationId) {
      const scope = principal.role === 'admin'
        ? eq(authorizations.id, authorizationId)
        : and(eq(authorizations.id, authorizationId), eq(authorizations.createdBy, principal.id));
      const [existing] = await tx.select({ id: authorizations.id }).from(authorizations).where(scope).limit(1);
      if (!existing) throw new CallRecordNotFoundError('The selected tracking record was not found.');
    } else {
      const [created] = await tx.insert(authorizations).values({
        lobId: lob?.id ?? null,
        createdBy: principal.id,
      }).returning({ id: authorizations.id });
      if (!created) throw new Error('The tracking record could not be created.');
      authorizationId = created.id;
      createdAuthorization = true;
    }

    const failedOutcome = value.contactOutcome === 'reached' ? null : value.contactOutcome;
    const reached = failedOutcome === null;
    const effectiveSchedulingStatus = inferredSchedulingStatus(value);
    const didNotLeaveVm = value.contactOutcome === 'voicemail_not_left';
    const derived = reached
      ? deriveResult({
          didNotLeaveVm,
          accepting: value.acceptingNewPatients,
          canTreat: value.canTreatDiagnosis,
          schedule: effectiveSchedulingStatus,
        })
      : {
          resultCode: 'unable_to_contact' as const,
          resultPhrase: failedContactPhrases[failedOutcome],
        };
    const duplicateGroupKey = stableHash(
      'weekly_duplicate',
      facility.id,
      diagnosis?.code ?? '',
      weekStartForDate(value.callAt),
    );
    const signature = JSON.stringify([
      principal.id,
      facility.id,
      value.callAt.toISOString(),
      authorizationId,
      specialty?.id ?? null,
      diagnosis?.id ?? null,
      value.contactOutcome,
    ]);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${signature}, 0))`);
    const [existingCall] = await tx.select({ id: calls.id, authorizationId: calls.authorizationId }).from(calls).where(and(
      eq(calls.callerUserId, principal.id),
      eq(calls.facilityId, facility.id),
      eq(calls.callAt, value.callAt),
      eq(calls.authorizationId, authorizationId),
      sql`${calls.specialtySnapshot} is not distinct from ${specialty?.name ?? null}`,
      sql`${calls.diagnosisCodeSnapshot} is not distinct from ${diagnosis?.code ?? null}`,
    )).limit(1);
    if (existingCall?.authorizationId) {
      return {
        id: existingCall.id,
        duplicate: true,
        authorizationId: existingCall.authorizationId,
        trackingId: formatTrackingId(existingCall.authorizationId),
      };
    }

    const [call] = await tx.insert(calls).values({
      authorizationId,
      facilityId: facility.id,
      callerUserId: principal.id,
      callAt: value.callAt,
      callerInitialsSnapshot: caller?.initials ?? null,
      lobSnapshot: lob?.code ?? null,
      facilitySnapshot: facility.facilityName,
      diagnosisCodeSnapshot: diagnosis?.code ?? null,
      diagnosisDescriptionSnapshot: diagnosis?.description ?? null,
      specialtySnapshot: specialty?.name ?? null,
      phoneSnapshot: value.phone ?? facility.phoneRaw,
      didNotLeaveVm,
      acceptingNewPatients: value.acceptingNewPatients,
      canTreatDiagnosis: value.canTreatDiagnosis,
      canScheduleWithinFourWeeks: effectiveSchedulingStatus,
      notes: value.notes,
      specialtyConfirmed: value.specialtyConfirmed,
      weekStart: weekStartForDate(value.callAt),
      duplicateGroupKey,
      resultCode: derived.resultCode,
      resultPhrase: derived.resultPhrase,
      sourceMetadata: { source: 'manual_entry', contactOutcome: value.contactOutcome },
    }).returning();

    if (failedOutcome) {
      await tx.insert(facilityContactAttempts).values({
        facilityId: facility.id,
        attemptedAt: value.callAt,
        attemptedBy: principal.id,
        method: 'phone',
        outcome: failedOutcome,
        comments: value.notes,
        relatedCallId: call.id,
      });
    } else {
      const acceptingStatus = verificationAnswer(value.acceptingNewPatients);
      const specialtyStatus = verificationAnswer(value.specialtyConfirmed);
      const diagnosisStatus = verificationAnswer(value.canTreatDiagnosis);
      const schedulingStatus = schedulingAnswer(effectiveSchedulingStatus);
      const urgentReferralStatus = effectiveSchedulingStatus === 'urgent_referral_required'
        ? ('yes' as const)
        : isConfirmed(schedulingStatus) ? ('no' as const) : null;
      const hasBookingTiming = Boolean(value.nextAvailableDate)
        || (value.estimatedWaitDays !== null && value.estimatedWaitDays !== undefined);
      const hasConfirmedFact = [acceptingStatus, specialtyStatus, diagnosisStatus, schedulingStatus].some(isConfirmed) || hasBookingTiming;
      let resultingFacility = facility;

      if (hasConfirmedFact) {
        const [updated] = await tx.update(facilities).set({
          ...(isConfirmed(acceptingStatus) ? {
            currentAcceptingStatus: sql`case when ${facilities.acceptingVerifiedAt} is null or ${facilities.acceptingVerifiedAt} <= ${value.callAt} then ${acceptingStatus}::verification_answer else ${facilities.currentAcceptingStatus} end`,
            acceptingVerifiedAt: sql`greatest(${facilities.acceptingVerifiedAt}, ${value.callAt})`,
          } : {}),
          ...(isConfirmed(schedulingStatus) ? {
            currentSchedulingStatus: sql`case when ${facilities.schedulingVerifiedAt} is null or ${facilities.schedulingVerifiedAt} <= ${value.callAt} then ${schedulingStatus}::verification_answer else ${facilities.currentSchedulingStatus} end`,
            currentUrgentReferralStatus: sql`case when ${facilities.schedulingVerifiedAt} is null or ${facilities.schedulingVerifiedAt} <= ${value.callAt} then ${effectiveSchedulingStatus === 'urgent_referral_required' ? 'yes' : 'no'}::verification_answer else ${facilities.currentUrgentReferralStatus} end`,
            schedulingVerifiedAt: sql`greatest(${facilities.schedulingVerifiedAt}, ${value.callAt})`,
          } : {}),
          ...(isConfirmed(acceptingStatus) || isConfirmed(schedulingStatus) || hasBookingTiming ? {
            nextAvailableDate: sql`case when greatest(${facilities.acceptingVerifiedAt}, ${facilities.schedulingVerifiedAt}) is null or greatest(${facilities.acceptingVerifiedAt}, ${facilities.schedulingVerifiedAt}) <= ${value.callAt} then ${value.nextAvailableDate}::date else ${facilities.nextAvailableDate} end`,
            estimatedWaitDays: sql`case when greatest(${facilities.acceptingVerifiedAt}, ${facilities.schedulingVerifiedAt}) is null or greatest(${facilities.acceptingVerifiedAt}, ${facilities.schedulingVerifiedAt}) <= ${value.callAt} then ${value.estimatedWaitDays}::integer else ${facilities.estimatedWaitDays} end`,
          } : {}),
          lastVerifiedAt: sql`greatest(${facilities.lastVerifiedAt}, ${value.callAt})`,
          optimisticLockVersion: sql`${facilities.optimisticLockVersion} + 1`,
          updatedAt: new Date(),
        }).where(eq(facilities.id, facility.id)).returning();
        resultingFacility = updated ?? facility;
      }

      if (specialty?.id) {
        await tx.insert(facilitySpecialties).values({
          facilityId: facility.id,
          specialtyId: specialty.id,
          verificationStatus: specialtyStatus,
          lastConfirmedAt: isConfirmed(specialtyStatus) ? value.callAt : null,
          confirmingCallId: call.id,
        }).onConflictDoUpdate({
          target: [facilitySpecialties.facilityId, facilitySpecialties.specialtyId],
          set: {
            verificationStatus: sql`case when ${facilitySpecialties.lastConfirmedAt} is null or ${facilitySpecialties.lastConfirmedAt} <= ${value.callAt} then ${specialtyStatus}::verification_answer else ${facilitySpecialties.verificationStatus} end`,
            lastConfirmedAt: isConfirmed(specialtyStatus) ? sql`greatest(${facilitySpecialties.lastConfirmedAt}, ${value.callAt})` : facilitySpecialties.lastConfirmedAt,
            confirmingCallId: call.id,
            optimisticLockVersion: sql`${facilitySpecialties.optimisticLockVersion} + 1`,
            updatedAt: new Date(),
          },
        });
      }

      if (diagnosis?.id) {
        await tx.insert(facilityDiagnosisCapabilities).values({
          facilityId: facility.id,
          diagnosisId: diagnosis.id,
          status: diagnosisStatus,
          lastVerifiedAt: isConfirmed(diagnosisStatus) ? value.callAt : null,
          sourceMetadata: { source: 'manual_call', callId: call.id },
        }).onConflictDoUpdate({
          target: [facilityDiagnosisCapabilities.facilityId, facilityDiagnosisCapabilities.diagnosisId],
          set: {
            status: sql`case when ${facilityDiagnosisCapabilities.lastVerifiedAt} is null or ${facilityDiagnosisCapabilities.lastVerifiedAt} <= ${value.callAt} then ${diagnosisStatus}::verification_answer else ${facilityDiagnosisCapabilities.status} end`,
            lastVerifiedAt: isConfirmed(diagnosisStatus) ? sql`greatest(${facilityDiagnosisCapabilities.lastVerifiedAt}, ${value.callAt})` : facilityDiagnosisCapabilities.lastVerifiedAt,
            sourceMetadata: sql`${facilityDiagnosisCapabilities.sourceMetadata} || ${JSON.stringify({ source: 'manual_call', callId: call.id })}::jsonb`,
            optimisticLockVersion: sql`${facilityDiagnosisCapabilities.optimisticLockVersion} + 1`,
            updatedAt: new Date(),
          },
        });
      }

      await tx.insert(facilityVerificationEvents).values({
        facilityId: facility.id,
        verifiedAt: value.callAt,
        verifiedBy: principal.id,
        method: 'phone',
        confidence: 'direct',
        acceptingStatus,
        specialtyId: specialty?.id ?? null,
        specialtyStatus,
        diagnosisId: diagnosis?.id ?? null,
        diagnosisStatus,
        schedulingWithinFourWeeks: schedulingStatus,
        urgentReferralStatus,
        nextAvailableDate: value.nextAvailableDate,
        estimatedWaitDays: value.estimatedWaitDays,
        comments: value.notes,
        relatedCallId: call.id,
        previousState: {
          acceptingStatus: facility.currentAcceptingStatus,
          schedulingWithinFourWeeks: facility.currentSchedulingStatus,
          urgentReferralStatus: facility.currentUrgentReferralStatus,
          nextAvailableDate: facility.nextAvailableDate,
          estimatedWaitDays: facility.estimatedWaitDays,
          lastVerifiedAt: facility.lastVerifiedAt?.toISOString() ?? null,
        },
        resultingState: {
          acceptingStatus: resultingFacility.currentAcceptingStatus,
          schedulingWithinFourWeeks: resultingFacility.currentSchedulingStatus,
          urgentReferralStatus: resultingFacility.currentUrgentReferralStatus,
          nextAvailableDate: resultingFacility.nextAvailableDate,
          estimatedWaitDays: resultingFacility.estimatedWaitDays,
          lastVerifiedAt: resultingFacility.lastVerifiedAt?.toISOString() ?? null,
        },
        sourceMetadata: { source: 'manual_call' },
      });
    }

    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'call.create',
      result: 'success',
      entityType: 'call',
      entityId: call.id,
      request,
      metadata: {
        facilityId: facility.id,
        resultCode: call.resultCode,
        createdAuthorization,
      },
    }));

    return {
      id: call.id,
      duplicate: false,
      authorizationId,
      trackingId: formatTrackingId(authorizationId),
    };
  });
}

export function callServiceErrorResponse(error: unknown): Response | null {
  if (error instanceof CallRecordNotFoundError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}
