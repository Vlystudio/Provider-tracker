import 'server-only';

import { and, asc, desc, eq, sql } from 'drizzle-orm';
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
import { assertPermission, type Principal } from './authorization';
import { buildAuditEvent } from './audit';
import { requireDatabaseClient } from './database';

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
  authorizationNumber: optionalText(100).transform((value) => value?.toUpperCase() ?? null),
  lobId: z.string().uuid().nullable().optional().transform((value) => value || null),
  specialtyId: z.string().uuid().nullable().optional().transform((value) => value || null),
  diagnosisId: z.string().uuid().nullable().optional().transform((value) => value || null),
  phone: optionalText(40),
  contactOutcome: z.enum(contactOutcomes),
  acceptingNewPatients: z.enum(availabilityStatuses).default('unknown'),
  canTreatDiagnosis: z.enum(treatmentStatuses).default('unknown'),
  canScheduleWithinFourWeeks: z.enum(scheduleStatuses).default('unknown'),
  bookingOut: optionalText(250),
  notes: optionalText(2000),
  specialtyConfirmed: z.enum(availabilityStatuses).default('unknown'),
  useInFdm: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.callAt.valueOf() > Date.now() + 5 * 60_000) {
    context.addIssue({ code: 'custom', path: ['callAt'], message: 'Call time cannot be in the future.' });
  }
  if (value.callAt.getUTCFullYear() < 2000) {
    context.addIssue({ code: 'custom', path: ['callAt'], message: 'Call time is outside the supported range.' });
  }
});

export type CallEntryInput = z.infer<typeof callEntryInputSchema>;

export type CallEntryOption = { id: string; label: string; phone?: string | null };

export type CallLogRow = {
  id: string;
  number: string;
  provider: string;
  outcome: string;
  status: 'Complete' | 'Follow-up';
  date: string;
  calledAt: string;
  caller: string;
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

export async function listCallLog(principal: Principal): Promise<CallLogRow[]> {
  assertPermission(principal, 'operations:read');
  const rows = await requireDatabaseClient().select({
    id: calls.id,
    authorizationNumber: calls.authorizationNumberSnapshot,
    facility: calls.facilitySnapshot,
    resultCode: calls.resultCode,
    resultPhrase: calls.resultPhrase,
    callAt: calls.callAt,
    callerName: sql<string>`coalesce(${users.displayName}, ${users.name}, ${calls.callerInitialsSnapshot}, 'Not recorded')`,
  }).from(calls)
    .leftJoin(users, eq(calls.callerUserId, users.id))
    .orderBy(desc(calls.callAt))
    .limit(500);

  return rows.map((row) => ({
    id: row.id,
    number: row.authorizationNumber || 'Not recorded',
    provider: row.facility,
    outcome: row.resultPhrase,
    status: row.resultCode === 'unable_to_contact' ? 'Follow-up' : 'Complete',
    date: row.callAt.toISOString().slice(0, 10),
    calledAt: row.callAt.toISOString(),
    caller: row.callerName,
  }));
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

    let authorizationId: string | null = null;
    let createdAuthorization = false;
    if (value.authorizationNumber) {
      const [inserted] = await tx.insert(authorizations).values({
        authorizationNumber: value.authorizationNumber,
        lobId: lob?.id ?? null,
        defaultDiagnosisId: diagnosis?.id ?? null,
        defaultSpecialtyId: specialty?.id ?? null,
        createdBy: principal.id,
      }).onConflictDoNothing({ target: authorizations.authorizationNumber }).returning({ id: authorizations.id });
      createdAuthorization = Boolean(inserted);
      if (inserted) {
        authorizationId = inserted.id;
      } else {
        const [existing] = await tx.select({ id: authorizations.id }).from(authorizations)
          .where(eq(authorizations.authorizationNumber, value.authorizationNumber)).limit(1);
        authorizationId = existing?.id ?? null;
      }
    }

    const failedOutcome = value.contactOutcome === 'reached' ? null : value.contactOutcome;
    const reached = failedOutcome === null;
    const didNotLeaveVm = value.contactOutcome === 'voicemail_not_left';
    const derived = reached
      ? deriveResult({
          didNotLeaveVm,
          accepting: value.acceptingNewPatients,
          canTreat: value.canTreatDiagnosis,
          schedule: value.canScheduleWithinFourWeeks,
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
      value.authorizationNumber,
      specialty?.id ?? null,
      diagnosis?.id ?? null,
      value.contactOutcome,
    ]);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${signature}, 0))`);
    const [existingCall] = await tx.select({ id: calls.id }).from(calls).where(and(
      eq(calls.callerUserId, principal.id),
      eq(calls.facilityId, facility.id),
      eq(calls.callAt, value.callAt),
      sql`${calls.authorizationNumberSnapshot} is not distinct from ${value.authorizationNumber}`,
      sql`${calls.specialtySnapshot} is not distinct from ${specialty?.name ?? null}`,
      sql`${calls.diagnosisCodeSnapshot} is not distinct from ${diagnosis?.code ?? null}`,
    )).limit(1);
    if (existingCall) return { id: existingCall.id, duplicate: true };

    const [call] = await tx.insert(calls).values({
      authorizationId,
      facilityId: facility.id,
      callerUserId: principal.id,
      callAt: value.callAt,
      callerInitialsSnapshot: caller?.initials ?? null,
      lobSnapshot: lob?.code ?? null,
      authorizationNumberSnapshot: value.authorizationNumber,
      facilitySnapshot: facility.facilityName,
      diagnosisCodeSnapshot: diagnosis?.code ?? null,
      diagnosisDescriptionSnapshot: diagnosis?.description ?? null,
      specialtySnapshot: specialty?.name ?? null,
      phoneSnapshot: value.phone ?? facility.phoneRaw,
      didNotLeaveVm,
      acceptingNewPatients: value.acceptingNewPatients,
      canTreatDiagnosis: value.canTreatDiagnosis,
      canScheduleWithinFourWeeks: value.canScheduleWithinFourWeeks,
      bookingOutRaw: value.bookingOut,
      notes: value.notes,
      specialtyConfirmed: value.specialtyConfirmed,
      useInFdm: value.useInFdm,
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
        contactChannel: value.phone ?? facility.phoneRaw,
        comments: value.notes,
        relatedCallId: call.id,
      });
    } else {
      const acceptingStatus = verificationAnswer(value.acceptingNewPatients);
      const specialtyStatus = verificationAnswer(value.specialtyConfirmed);
      const diagnosisStatus = verificationAnswer(value.canTreatDiagnosis);
      const schedulingStatus = schedulingAnswer(value.canScheduleWithinFourWeeks);
      const urgentReferralStatus = value.canScheduleWithinFourWeeks === 'urgent_referral_required'
        ? ('yes' as const)
        : isConfirmed(schedulingStatus) ? ('no' as const) : null;
      const hasConfirmedFact = [acceptingStatus, specialtyStatus, diagnosisStatus, schedulingStatus].some(isConfirmed);
      let resultingFacility = facility;

      if (hasConfirmedFact) {
        const [updated] = await tx.update(facilities).set({
          ...(isConfirmed(acceptingStatus) ? {
            currentAcceptingStatus: sql`case when ${facilities.acceptingVerifiedAt} is null or ${facilities.acceptingVerifiedAt} <= ${value.callAt} then ${acceptingStatus}::verification_answer else ${facilities.currentAcceptingStatus} end`,
            acceptingVerifiedAt: sql`greatest(${facilities.acceptingVerifiedAt}, ${value.callAt})`,
          } : {}),
          ...(isConfirmed(schedulingStatus) ? {
            currentSchedulingStatus: sql`case when ${facilities.schedulingVerifiedAt} is null or ${facilities.schedulingVerifiedAt} <= ${value.callAt} then ${schedulingStatus}::verification_answer else ${facilities.currentSchedulingStatus} end`,
            currentUrgentReferralStatus: sql`case when ${facilities.schedulingVerifiedAt} is null or ${facilities.schedulingVerifiedAt} <= ${value.callAt} then ${value.canScheduleWithinFourWeeks === 'urgent_referral_required' ? 'yes' : 'no'}::verification_answer else ${facilities.currentUrgentReferralStatus} end`,
            schedulingVerifiedAt: sql`greatest(${facilities.schedulingVerifiedAt}, ${value.callAt})`,
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
        contactChannel: value.phone ?? facility.phoneRaw,
        acceptingStatus,
        specialtyId: specialty?.id ?? null,
        specialtyStatus,
        diagnosisId: diagnosis?.id ?? null,
        diagnosisStatus,
        schedulingWithinFourWeeks: schedulingStatus,
        urgentReferralStatus,
        comments: value.notes,
        relatedCallId: call.id,
        previousState: {
          acceptingStatus: facility.currentAcceptingStatus,
          schedulingWithinFourWeeks: facility.currentSchedulingStatus,
          urgentReferralStatus: facility.currentUrgentReferralStatus,
          lastVerifiedAt: facility.lastVerifiedAt?.toISOString() ?? null,
        },
        resultingState: {
          acceptingStatus: resultingFacility.currentAcceptingStatus,
          schedulingWithinFourWeeks: resultingFacility.currentSchedulingStatus,
          urgentReferralStatus: resultingFacility.currentUrgentReferralStatus,
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

    return { id: call.id, duplicate: false };
  });
}

export function callServiceErrorResponse(error: unknown): Response | null {
  if (error instanceof CallRecordNotFoundError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}
