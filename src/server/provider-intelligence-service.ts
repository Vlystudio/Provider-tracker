import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  auditEvents,
  calls,
  diagnoses,
  facilities,
  facilityContactAttempts,
  facilityDiagnosisCapabilities,
  facilityDuplicateCandidates,
  facilityMergeRecords,
  facilitySpecialties,
  facilityVerificationEvents,
  reverificationAssignments,
  specialties,
  users,
} from '@/db/schema';
import {
  calculateReverificationPriority,
  classifyFreshness,
  duplicateSignals,
  verificationAnswers,
  type VerificationAnswer,
} from '@/lib/provider-intelligence';
import { assertPermission, assertRecentAuthentication, type Principal } from './authorization';
import { buildAuditEvent } from './audit';
import { getFreshnessPolicy } from './config';
import { measureOperation } from './metrics';
import { requireDatabaseClient } from './database';

export class RecordConflictError extends Error {
  readonly status = 409;
  constructor(message = 'This record changed after you opened it. Refresh and try again.') {
    super(message);
  }
}

export class RecordNotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'The record was not found.') {
    super(message);
  }
}

export const facilityIdSchema = z.string().uuid();
const answerSchema = z.enum(verificationAnswers);
const verifiedFactFields = [
  'acceptingStatus',
  'specialtyStatus',
  'diagnosisStatus',
  'schedulingWithinFourWeeks',
  'urgentReferralStatus',
] as const;

export const verificationEventInputSchema = z.object({
  expectedVersion: z.number().int().min(0),
  verifiedAt: z.coerce.date(),
  method: z.enum(['phone', 'fax', 'portal', 'website', 'email', 'internal_source', 'other']),
  confidence: z.enum(['direct', 'authoritative', 'secondary', 'unverified']).default('direct'),
  contactPerson: z.string().trim().max(200).nullable().optional(),
  contactChannel: z.string().trim().max(200).nullable().optional(),
  acceptingStatus: answerSchema.optional(),
  specialtyId: z.string().uuid().nullable().optional(),
  specialtyStatus: answerSchema.optional(),
  diagnosisId: z.string().uuid().nullable().optional(),
  diagnosisStatus: answerSchema.optional(),
  schedulingWithinFourWeeks: answerSchema.optional(),
  urgentReferralStatus: answerSchema.optional(),
  nextAvailableDate: z.string().date().nullable().optional(),
  estimatedWaitDays: z.number().int().min(0).max(3650).nullable().optional(),
  comments: z.string().trim().max(2000).nullable().optional(),
  relatedCallId: z.string().uuid().nullable().optional(),
}).strict().superRefine((value, context) => {
  const hasFact = verifiedFactFields.some((field) => value[field] !== undefined)
    || value.nextAvailableDate !== undefined
    || value.estimatedWaitDays !== undefined;
  if (!hasFact && !value.comments) {
    context.addIssue({ code: 'custom', message: 'Record at least one verified fact or comment.' });
  }
  if (value.specialtyStatus !== undefined && !value.specialtyId) {
    context.addIssue({ code: 'custom', path: ['specialtyId'], message: 'Choose the specialty that was checked.' });
  }
  if (value.diagnosisStatus !== undefined && !value.diagnosisId) {
    context.addIssue({ code: 'custom', path: ['diagnosisId'], message: 'Choose the diagnosis that was checked.' });
  }
  if (value.verifiedAt.valueOf() > Date.now() + 5 * 60_000) {
    context.addIssue({ code: 'custom', path: ['verifiedAt'], message: 'Verification time cannot be in the future.' });
  }
});

export const contactAttemptInputSchema = z.object({
  attemptedAt: z.coerce.date(),
  method: z.enum(['phone', 'fax', 'portal', 'website', 'email', 'internal_source', 'other']),
  outcome: z.enum([
    'verified', 'no_answer', 'voicemail_left', 'voicemail_not_left', 'disconnected', 'wrong_number',
    'fax_only', 'callback_requested', 'unable_to_verify',
  ]),
  contactPerson: z.string().trim().max(200).nullable().optional(),
  contactChannel: z.string().trim().max(200).nullable().optional(),
  comments: z.string().trim().max(2000).nullable().optional(),
  relatedCallId: z.string().uuid().nullable().optional(),
}).strict().refine((value) => value.attemptedAt.valueOf() <= Date.now() + 5 * 60_000, {
  path: ['attemptedAt'], message: 'Contact time cannot be in the future.',
});

export const facilityPatchSchema = z.object({
  expectedVersion: z.number().int().min(0),
  facilityName: z.string().trim().min(1).max(250).optional(),
  addressLine1: z.string().trim().max(250).nullable().optional(),
  addressLine2: z.string().trim().max(250).nullable().optional(),
  city: z.string().trim().min(1).max(120).optional(),
  stateCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().optional(),
  postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/).nullable().optional(),
  phoneRaw: z.string().trim().max(40).nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedVersion'), {
  message: 'At least one editable field is required.',
});

export const duplicateDecisionInputSchema = z.object({
  decision: z.enum(['not_duplicate', 'deferred']),
  note: z.string().trim().min(2).max(500),
}).strict();

export const facilityMergeInputSchema = z.object({
  survivorFacilityId: z.string().uuid(),
  mergedFacilityId: z.string().uuid(),
  candidateId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(5).max(500),
  survivorExpectedVersion: z.number().int().min(0),
  mergedExpectedVersion: z.number().int().min(0),
  confirmation: z.literal('MERGE'),
}).strict().refine((value) => value.survivorFacilityId !== value.mergedFacilityId, {
  message: 'Choose two different facilities.',
});

export const bulkAssignmentInputSchema = z.object({
  facilityIds: z.array(z.string().uuid()).min(1).max(100),
  assignedTo: z.string().uuid(),
  reasonCodes: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
}).strict();

function normalized(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : digits || null;
}

function shouldRefreshTimestamp(value: VerificationAnswer | undefined): boolean {
  return value === 'yes' || value === 'no' || value === 'not_applicable';
}

export async function createVerificationEvent(
  principal: Principal,
  facilityId: string,
  input: z.infer<typeof verificationEventInputSchema>,
  request?: Request,
) {
  assertPermission(principal, 'operations:write');
  const parsedId = facilityIdSchema.parse(facilityId);
  const value = verificationEventInputSchema.parse(input);
  const db = requireDatabaseClient();

  return db.transaction(async (tx) => {
    const [facility] = await tx.select().from(facilities).where(and(eq(facilities.id, parsedId), eq(facilities.active, true))).limit(1);
    if (!facility) throw new RecordNotFoundError('The active facility was not found.');
    if (facility.optimisticLockVersion !== value.expectedVersion) throw new RecordConflictError();

    const [previousSpecialty] = value.specialtyId
      ? await tx.select({ status: facilitySpecialties.verificationStatus }).from(facilitySpecialties)
          .where(and(eq(facilitySpecialties.facilityId, facility.id), eq(facilitySpecialties.specialtyId, value.specialtyId))).limit(1)
      : [];
    const [previousDiagnosis] = value.diagnosisId
      ? await tx.select({ status: facilityDiagnosisCapabilities.status }).from(facilityDiagnosisCapabilities)
          .where(and(eq(facilityDiagnosisCapabilities.facilityId, facility.id), eq(facilityDiagnosisCapabilities.diagnosisId, value.diagnosisId))).limit(1)
      : [];
    const previousState = {
      acceptingStatus: facility.currentAcceptingStatus,
      schedulingWithinFourWeeks: facility.currentSchedulingStatus,
      urgentReferralStatus: facility.currentUrgentReferralStatus,
      nextAvailableDate: facility.nextAvailableDate,
      estimatedWaitDays: facility.estimatedWaitDays,
      lastVerifiedAt: facility.lastVerifiedAt?.toISOString() ?? null,
      ...(value.specialtyId ? { specialtyStatus: previousSpecialty?.status ?? null } : {}),
      ...(value.diagnosisId ? { diagnosisStatus: previousDiagnosis?.status ?? null } : {}),
    };
    const facilityPatch: Partial<typeof facilities.$inferInsert> = {
      optimisticLockVersion: facility.optimisticLockVersion + 1,
      updatedAt: new Date(),
    };
    let refreshedAField = false;
    if (value.acceptingStatus !== undefined && value.acceptingStatus !== 'not_asked') {
      facilityPatch.currentAcceptingStatus = value.acceptingStatus;
      if (shouldRefreshTimestamp(value.acceptingStatus)) {
        facilityPatch.acceptingVerifiedAt = value.verifiedAt;
        refreshedAField = true;
      }
    }
    if (value.schedulingWithinFourWeeks !== undefined && value.schedulingWithinFourWeeks !== 'not_asked') {
      facilityPatch.currentSchedulingStatus = value.schedulingWithinFourWeeks;
      if (shouldRefreshTimestamp(value.schedulingWithinFourWeeks)) {
        facilityPatch.schedulingVerifiedAt = value.verifiedAt;
        refreshedAField = true;
      }
    }
    if (value.urgentReferralStatus !== undefined && value.urgentReferralStatus !== 'not_asked') {
      facilityPatch.currentUrgentReferralStatus = value.urgentReferralStatus;
      if (shouldRefreshTimestamp(value.urgentReferralStatus)) refreshedAField = true;
    }
    if (value.nextAvailableDate !== undefined) {
      facilityPatch.nextAvailableDate = value.nextAvailableDate;
      facilityPatch.schedulingVerifiedAt = value.verifiedAt;
      refreshedAField = true;
    }
    if (value.estimatedWaitDays !== undefined) {
      facilityPatch.estimatedWaitDays = value.estimatedWaitDays;
      facilityPatch.schedulingVerifiedAt = value.verifiedAt;
      refreshedAField = true;
    }
    if (refreshedAField) facilityPatch.lastVerifiedAt = value.verifiedAt;

    if (value.specialtyId && value.specialtyStatus !== undefined) {
      const specialtyPatch = {
        verificationStatus: value.specialtyStatus,
        ...(shouldRefreshTimestamp(value.specialtyStatus) ? { lastConfirmedAt: value.verifiedAt } : {}),
        optimisticLockVersion: sql`${facilitySpecialties.optimisticLockVersion} + 1`,
        updatedAt: new Date(),
      };
      await tx.insert(facilitySpecialties).values({
        facilityId: facility.id,
        specialtyId: value.specialtyId,
        verificationStatus: value.specialtyStatus,
        lastConfirmedAt: shouldRefreshTimestamp(value.specialtyStatus) ? value.verifiedAt : null,
      }).onConflictDoUpdate({
        target: [facilitySpecialties.facilityId, facilitySpecialties.specialtyId],
        set: specialtyPatch,
      });
      if (shouldRefreshTimestamp(value.specialtyStatus)) refreshedAField = true;
    }

    if (value.diagnosisId && value.diagnosisStatus !== undefined) {
      await tx.insert(facilityDiagnosisCapabilities).values({
        facilityId: facility.id,
        diagnosisId: value.diagnosisId,
        status: value.diagnosisStatus,
        lastVerifiedAt: shouldRefreshTimestamp(value.diagnosisStatus) ? value.verifiedAt : null,
      }).onConflictDoUpdate({
        target: [facilityDiagnosisCapabilities.facilityId, facilityDiagnosisCapabilities.diagnosisId],
        set: {
          status: value.diagnosisStatus,
          ...(shouldRefreshTimestamp(value.diagnosisStatus) ? { lastVerifiedAt: value.verifiedAt } : {}),
          optimisticLockVersion: sql`${facilityDiagnosisCapabilities.optimisticLockVersion} + 1`,
          updatedAt: new Date(),
        },
      });
      if (shouldRefreshTimestamp(value.diagnosisStatus)) refreshedAField = true;
    }

    if (refreshedAField) facilityPatch.lastVerifiedAt = value.verifiedAt;
    const [updated] = await tx.update(facilities).set(facilityPatch)
      .where(and(eq(facilities.id, facility.id), eq(facilities.optimisticLockVersion, value.expectedVersion)))
      .returning();
    if (!updated) throw new RecordConflictError();

    const resultingState = {
      acceptingStatus: updated.currentAcceptingStatus,
      schedulingWithinFourWeeks: updated.currentSchedulingStatus,
      urgentReferralStatus: updated.currentUrgentReferralStatus,
      nextAvailableDate: updated.nextAvailableDate,
      estimatedWaitDays: updated.estimatedWaitDays,
      lastVerifiedAt: updated.lastVerifiedAt?.toISOString() ?? null,
      ...(value.specialtyId ? { specialtyStatus: value.specialtyStatus ?? previousSpecialty?.status ?? null } : {}),
      ...(value.diagnosisId ? { diagnosisStatus: value.diagnosisStatus ?? previousDiagnosis?.status ?? null } : {}),
    };
    const [event] = await tx.insert(facilityVerificationEvents).values({
      facilityId: facility.id,
      verifiedAt: value.verifiedAt,
      verifiedBy: principal.id,
      method: value.method,
      confidence: value.confidence,
      contactPerson: value.contactPerson ?? null,
      contactChannel: value.contactChannel ?? null,
      acceptingStatus: value.acceptingStatus,
      specialtyId: value.specialtyId ?? null,
      specialtyStatus: value.specialtyStatus,
      diagnosisId: value.diagnosisId ?? null,
      diagnosisStatus: value.diagnosisStatus,
      schedulingWithinFourWeeks: value.schedulingWithinFourWeeks,
      urgentReferralStatus: value.urgentReferralStatus,
      nextAvailableDate: value.nextAvailableDate,
      estimatedWaitDays: value.estimatedWaitDays,
      comments: value.comments ?? null,
      relatedCallId: value.relatedCallId ?? null,
      previousState,
      resultingState,
    }).returning();

    await tx.insert(auditEvents).values(
      buildAuditEvent({
        actorId: principal.id,
        action: 'facility.verification.create',
        result: 'success',
        entityType: 'facility',
        entityId: facility.id,
        request,
        metadata: {
          eventId: event.id,
          method: value.method,
          changedFieldCount: verifiedFactFields.filter((field) => value[field] !== undefined).length,
        },
      }),
    );
    return { event, facility: updated };
  });
}

export async function createContactAttempt(
  principal: Principal,
  facilityId: string,
  input: z.infer<typeof contactAttemptInputSchema>,
  request?: Request,
) {
  assertPermission(principal, 'operations:write');
  const parsedId = facilityIdSchema.parse(facilityId);
  const value = contactAttemptInputSchema.parse(input);
  const db = requireDatabaseClient();
  return db.transaction(async (tx) => {
    const [facility] = await tx.select({ id: facilities.id }).from(facilities)
      .where(and(eq(facilities.id, parsedId), eq(facilities.active, true))).limit(1);
    if (!facility) throw new RecordNotFoundError('The active facility was not found.');
    const signature = JSON.stringify([
      facility.id,
      principal.id,
      value.attemptedAt.toISOString(),
      value.method,
      value.outcome,
      value.contactPerson ?? null,
      value.contactChannel ?? null,
      value.comments ?? null,
      value.relatedCallId ?? null,
    ]);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${signature}, 0))`);
    const [existing] = await tx.select().from(facilityContactAttempts).where(and(
      eq(facilityContactAttempts.facilityId, facility.id),
      eq(facilityContactAttempts.attemptedBy, principal.id),
      eq(facilityContactAttempts.attemptedAt, value.attemptedAt),
      eq(facilityContactAttempts.method, value.method),
      eq(facilityContactAttempts.outcome, value.outcome),
      sql`${facilityContactAttempts.contactPerson} is not distinct from ${value.contactPerson ?? null}`,
      sql`${facilityContactAttempts.contactChannel} is not distinct from ${value.contactChannel ?? null}`,
      sql`${facilityContactAttempts.comments} is not distinct from ${value.comments ?? null}`,
      sql`${facilityContactAttempts.relatedCallId} is not distinct from ${value.relatedCallId ?? null}`,
    )).limit(1);
    if (existing) return existing;
    const [attempt] = await tx.insert(facilityContactAttempts).values({
      facilityId: facility.id,
      attemptedAt: value.attemptedAt,
      attemptedBy: principal.id,
      method: value.method,
      outcome: value.outcome,
      contactPerson: value.contactPerson ?? null,
      contactChannel: value.contactChannel ?? null,
      comments: value.comments ?? null,
      relatedCallId: value.relatedCallId ?? null,
    }).returning();
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'facility.contact-attempt.create',
      result: 'success',
      entityType: 'facility',
      entityId: facility.id,
      request,
      metadata: { attemptId: attempt.id, method: value.method, outcome: value.outcome },
    }));
    return attempt;
  });
}

export async function updateFacility(
  principal: Principal,
  facilityId: string,
  input: z.infer<typeof facilityPatchSchema>,
  request?: Request,
) {
  assertPermission(principal, 'operations:write');
  const parsedId = facilityIdSchema.parse(facilityId);
  const value = facilityPatchSchema.parse(input);
  const { expectedVersion, ...changes } = value;
  const db = requireDatabaseClient();
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(facilities).where(eq(facilities.id, parsedId)).limit(1);
    if (!before) throw new RecordNotFoundError();
    if (before.optimisticLockVersion !== expectedVersion) throw new RecordConflictError();
    const patch: Partial<typeof facilities.$inferInsert> = {
      ...changes,
      ...(changes.facilityName ? { normalizedName: normalized(changes.facilityName) } : {}),
      ...(changes.city ? { normalizedCity: normalized(changes.city) } : {}),
      ...(changes.phoneRaw !== undefined ? { phoneNormalized: normalizePhone(changes.phoneRaw) } : {}),
      optimisticLockVersion: expectedVersion + 1,
      updatedAt: new Date(),
    };
    const [after] = await tx.update(facilities).set(patch)
      .where(and(eq(facilities.id, parsedId), eq(facilities.optimisticLockVersion, expectedVersion))).returning();
    if (!after) throw new RecordConflictError();
    const fields = Object.keys(changes);
    await tx.insert(auditEvents).values(
      buildAuditEvent({
        actorId: principal.id, action: 'facility.update', result: 'success', entityType: 'facility', entityId: parsedId,
        request, metadata: { changedFields: fields.join(',') },
      }),
    );
    return after;
  });
}

type ReverificationQueueInput = {
  query?: string;
  freshness?: string;
  assignedTo?: string;
  page?: number;
  pageSize?: number;
};

async function runReverificationQueue(principal: Principal, input: ReverificationQueueInput = {}) {
  assertPermission(principal, 'operations:read');
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize ?? 25)));
  const db = requireDatabaseClient();
  const activeFacilities = await db.select({
    id: facilities.id,
    facilityName: facilities.facilityName,
    city: facilities.city,
    phoneNormalized: facilities.phoneNormalized,
    currentAcceptingStatus: facilities.currentAcceptingStatus,
    acceptingVerifiedAt: facilities.acceptingVerifiedAt,
    schedulingVerifiedAt: facilities.schedulingVerifiedAt,
    lastVerifiedAt: facilities.lastVerifiedAt,
  }).from(facilities).where(eq(facilities.active, true));
  const ids = activeFacilities.map((facility) => facility.id);
  const [specialtyDates, diagnosisDates, callCounts, failureCounts, conflicts, assignments] = ids.length ? await Promise.all([
    db.select({ facilityId: facilitySpecialties.facilityId, latest: sql<Date | null>`max(${facilitySpecialties.lastConfirmedAt})` })
      .from(facilitySpecialties).where(inArray(facilitySpecialties.facilityId, ids)).groupBy(facilitySpecialties.facilityId),
    db.select({ facilityId: facilityDiagnosisCapabilities.facilityId, latest: sql<Date | null>`max(${facilityDiagnosisCapabilities.lastVerifiedAt})` })
      .from(facilityDiagnosisCapabilities).where(inArray(facilityDiagnosisCapabilities.facilityId, ids)).groupBy(facilityDiagnosisCapabilities.facilityId),
    db.select({ facilityId: calls.facilityId, count: sql<number>`count(*)::int` }).from(calls)
      .where(and(inArray(calls.facilityId, ids), sql`${calls.callAt} >= now() - interval '90 days'`)).groupBy(calls.facilityId),
    db.select({ facilityId: facilityContactAttempts.facilityId, count: sql<number>`count(*)::int` }).from(facilityContactAttempts)
      .where(and(inArray(facilityContactAttempts.facilityId, ids), sql`${facilityContactAttempts.outcome} <> 'verified'`, sql`${facilityContactAttempts.attemptedAt} >= now() - interval '90 days'`))
      .groupBy(facilityContactAttempts.facilityId),
    db.select({ facilityId: facilityVerificationEvents.facilityId }).from(facilityVerificationEvents)
      .where(and(inArray(facilityVerificationEvents.facilityId, ids), sql`${facilityVerificationEvents.verifiedAt} >= now() - interval '14 days'`))
      .groupBy(facilityVerificationEvents.facilityId)
      .having(sql`count(distinct ${facilityVerificationEvents.acceptingStatus}) filter (where ${facilityVerificationEvents.acceptingStatus} in ('yes','no')) > 1`),
    db.select({
      id: reverificationAssignments.id,
      facilityId: reverificationAssignments.facilityId,
      assignedTo: reverificationAssignments.assignedTo,
      assignedName: sql<string | null>`coalesce(${users.displayName}, ${users.name})`,
      reasonCodes: reverificationAssignments.reasonCodes,
      createdAt: reverificationAssignments.createdAt,
    }).from(reverificationAssignments).leftJoin(users, eq(reverificationAssignments.assignedTo, users.id))
      .where(and(inArray(reverificationAssignments.facilityId, ids), eq(reverificationAssignments.status, 'open'))),
  ]) : [[], [], [], [], [], []];
  const specialtyById = new Map(specialtyDates.map((row) => [row.facilityId, row.latest]));
  const diagnosisById = new Map(diagnosisDates.map((row) => [row.facilityId, row.latest]));
  const callsById = new Map(callCounts.map((row) => [row.facilityId, row.count]));
  const failuresById = new Map(failureCounts.map((row) => [row.facilityId, row.count]));
  const conflictIds = new Set(conflicts.map((row) => row.facilityId));
  const assignmentById = new Map(assignments.map((row) => [row.facilityId, row]));
  const policy = getFreshnessPolicy();
  const now = new Date();
  const query = input.query?.trim().toLowerCase() ?? '';
  const queue = activeFacilities.flatMap((facility) => {
    if (query && !`${facility.facilityName} ${facility.city}`.toLowerCase().includes(query)) return [];
    const acceptingFreshness = classifyFreshness('accepting', facility.acceptingVerifiedAt, now, policy);
    if (input.freshness && acceptingFreshness.state !== input.freshness) return [];
    const assignment = assignmentById.get(facility.id);
    if (input.assignedTo && assignment?.assignedTo !== input.assignedTo) return [];
    const unresolvedUnknowns = [facility.currentAcceptingStatus].filter((status) => status === 'unknown' || status === 'unable_to_verify').length;
    const priority = calculateReverificationPriority({
      acceptingVerifiedAt: facility.acceptingVerifiedAt,
      specialtyVerifiedAt: specialtyById.has(facility.id) ? specialtyById.get(facility.id) : undefined,
      diagnosisVerifiedAt: diagnosisById.has(facility.id) ? diagnosisById.get(facility.id) : undefined,
      schedulingVerifiedAt: facility.schedulingVerifiedAt,
      acceptingStatus: facility.currentAcceptingStatus,
      unresolvedUnknowns,
      recentCallCount: callsById.get(facility.id) ?? 0,
      recentFailedContacts: failuresById.get(facility.id) ?? 0,
      hasConflict: conflictIds.has(facility.id),
    }, now, policy);
    if (!priority.reasons.length) return [];
    return [{ ...facility, facilityId: facility.id, acceptingFreshness, priority, assignment: assignment ?? null }];
  }).sort((left, right) => right.priority.score - left.priority.score || left.facilityName.localeCompare(right.facilityName));
  const offset = (page - 1) * pageSize;
  return { rows: queue.slice(offset, offset + pageSize), total: queue.length, page, pageSize };
}

export async function listReverificationQueue(principal: Principal, input: ReverificationQueueInput = {}) {
  return measureOperation('reverification_queue', () => runReverificationQueue(principal, input));
}

export async function refreshDuplicateCandidates(principal: Principal, request?: Request) {
  assertPermission(principal, 'admin:manage-data');
  const db = requireDatabaseClient();
  const rows = await db.select({
    id: facilities.id,
    normalizedName: facilities.normalizedName,
    normalizedCity: facilities.normalizedCity,
    phoneNormalized: facilities.phoneNormalized,
    postalCode: facilities.postalCode,
    latitude: facilities.latitude,
    longitude: facilities.longitude,
  }).from(facilities).where(eq(facilities.active, true));
  const blocks = new Map<string, typeof rows>();
  for (const row of rows) {
    for (const key of [`name:${row.normalizedName}`, row.phoneNormalized ? `phone:${row.phoneNormalized}` : '', row.postalCode ? `zip:${row.postalCode.slice(0, 5)}` : ''].filter(Boolean)) {
      blocks.set(key, [...(blocks.get(key) ?? []), row]);
    }
  }
  const seen = new Set<string>();
  const candidates: Array<{ leftFacilityId: string; rightFacilityId: string; confidence: 'exact' | 'probable' | 'possible'; score: number; reasonCodes: string[] }> = [];
  for (const block of blocks.values()) {
    for (let leftIndex = 0; leftIndex < block.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < block.length; rightIndex += 1) {
        const [left, right] = [block[leftIndex], block[rightIndex]].sort((a, b) => a.id.localeCompare(b.id));
        const pair = `${left.id}:${right.id}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const signal = duplicateSignals(left, right);
        if (!signal.confidence) continue;
        candidates.push({ leftFacilityId: left.id, rightFacilityId: right.id, confidence: signal.confidence, score: signal.score, reasonCodes: signal.reasons });
      }
    }
  }
  return db.transaction(async (tx) => {
    for (const candidate of candidates) {
      await tx.insert(facilityDuplicateCandidates).values(candidate).onConflictDoUpdate({
        target: [facilityDuplicateCandidates.leftFacilityId, facilityDuplicateCandidates.rightFacilityId],
        set: {
          confidence: candidate.confidence,
          score: candidate.score,
          reasonCodes: candidate.reasonCodes,
          updatedAt: new Date(),
        },
        setWhere: eq(facilityDuplicateCandidates.decision, 'pending'),
      });
    }
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id, action: 'facility.duplicates.refresh', result: 'success', entityType: 'facility_duplicate_candidate',
      request, metadata: { candidateCount: candidates.length, facilityCount: rows.length },
    }));
    return { candidateCount: candidates.length, facilityCount: rows.length };
  });
}

export async function decideDuplicateCandidate(
  principal: Principal,
  candidateId: string,
  input: z.infer<typeof duplicateDecisionInputSchema>,
  request?: Request,
) {
  assertPermission(principal, 'admin:manage-data');
  const id = z.string().uuid().parse(candidateId);
  const value = duplicateDecisionInputSchema.parse(input);
  const [updated] = await requireDatabaseClient().update(facilityDuplicateCandidates).set({
    decision: value.decision,
    reviewNote: value.note,
    reviewedBy: principal.id,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(facilityDuplicateCandidates.id, id)).returning();
  if (!updated) throw new RecordNotFoundError('The duplicate candidate was not found.');
  await requireDatabaseClient().insert(auditEvents).values(buildAuditEvent({
    actorId: principal.id, action: 'facility.duplicate.decision', result: 'success', entityType: 'facility_duplicate_candidate',
    entityId: id, request, metadata: { decision: value.decision },
  }));
  return updated;
}

export async function mergeFacilities(
  principal: Principal,
  input: z.infer<typeof facilityMergeInputSchema>,
  request?: Request,
) {
  assertPermission(principal, 'admin:manage-data');
  assertRecentAuthentication(principal);
  const value = facilityMergeInputSchema.parse(input);
  const db = requireDatabaseClient();
  return db.transaction(async (tx) => {
    const records = await tx.select().from(facilities).where(inArray(facilities.id, [value.survivorFacilityId, value.mergedFacilityId]));
    const survivor = records.find((record) => record.id === value.survivorFacilityId);
    const merged = records.find((record) => record.id === value.mergedFacilityId);
    if (!survivor || !merged || !survivor.active || !merged.active) throw new RecordNotFoundError('Both active facilities are required.');
    if (survivor.optimisticLockVersion !== value.survivorExpectedVersion || merged.optimisticLockVersion !== value.mergedExpectedVersion) {
      throw new RecordConflictError();
    }
    const [survivorSpecialties, mergedSpecialties, survivorDiagnoses, mergedDiagnoses] = await Promise.all([
      tx.select().from(facilitySpecialties).where(eq(facilitySpecialties.facilityId, survivor.id)),
      tx.select().from(facilitySpecialties).where(eq(facilitySpecialties.facilityId, merged.id)),
      tx.select().from(facilityDiagnosisCapabilities).where(eq(facilityDiagnosisCapabilities.facilityId, survivor.id)),
      tx.select().from(facilityDiagnosisCapabilities).where(eq(facilityDiagnosisCapabilities.facilityId, merged.id)),
    ]);
    const survivorSpecialtyIds = new Set(survivorSpecialties.map((item) => item.specialtyId));
    const survivorDiagnosisIds = new Set(survivorDiagnoses.map((item) => item.diagnosisId));
    const copiedSpecialtyIds = mergedSpecialties.filter((item) => !survivorSpecialtyIds.has(item.specialtyId)).map((item) => item.specialtyId);
    const copiedDiagnosisIds = mergedDiagnoses.filter((item) => !survivorDiagnosisIds.has(item.diagnosisId)).map((item) => item.diagnosisId);
    for (const item of mergedSpecialties) {
      await tx.insert(facilitySpecialties).values({
        facilityId: survivor.id, specialtyId: item.specialtyId, treatmentStatus: item.treatmentStatus,
        verificationStatus: item.verificationStatus, active: item.active, notes: item.notes,
        lastConfirmedAt: item.lastConfirmedAt, confirmingCallId: item.confirmingCallId,
        sourceMetadata: { ...item.sourceMetadata, copiedFromFacilityId: merged.id },
      }).onConflictDoUpdate({
        target: [facilitySpecialties.facilityId, facilitySpecialties.specialtyId],
        set: {
          verificationStatus: sql`case when excluded.last_confirmed_at > ${facilitySpecialties.lastConfirmedAt} or ${facilitySpecialties.lastConfirmedAt} is null then excluded.verification_status else ${facilitySpecialties.verificationStatus} end`,
          lastConfirmedAt: sql`greatest(${facilitySpecialties.lastConfirmedAt}, excluded.last_confirmed_at)`,
          optimisticLockVersion: sql`${facilitySpecialties.optimisticLockVersion} + 1`,
          updatedAt: new Date(),
        },
      });
    }
    for (const item of mergedDiagnoses) {
      await tx.insert(facilityDiagnosisCapabilities).values({
        facilityId: survivor.id, diagnosisId: item.diagnosisId, status: item.status, active: item.active,
        notes: item.notes, lastVerifiedAt: item.lastVerifiedAt,
        sourceMetadata: { ...item.sourceMetadata, copiedFromFacilityId: merged.id },
      }).onConflictDoUpdate({
        target: [facilityDiagnosisCapabilities.facilityId, facilityDiagnosisCapabilities.diagnosisId],
        set: {
          status: sql`case when excluded.last_verified_at > ${facilityDiagnosisCapabilities.lastVerifiedAt} or ${facilityDiagnosisCapabilities.lastVerifiedAt} is null then excluded.status else ${facilityDiagnosisCapabilities.status} end`,
          lastVerifiedAt: sql`greatest(${facilityDiagnosisCapabilities.lastVerifiedAt}, excluded.last_verified_at)`,
          optimisticLockVersion: sql`${facilityDiagnosisCapabilities.optimisticLockVersion} + 1`,
          updatedAt: new Date(),
        },
      });
    }
    const mergedIsNewer = (merged.lastVerifiedAt?.valueOf() ?? 0) > (survivor.lastVerifiedAt?.valueOf() ?? 0);
    const [updatedSurvivor] = await tx.update(facilities).set({
      ...(mergedIsNewer ? {
        currentAcceptingStatus: merged.currentAcceptingStatus,
        currentSchedulingStatus: merged.currentSchedulingStatus,
        currentUrgentReferralStatus: merged.currentUrgentReferralStatus,
        nextAvailableDate: merged.nextAvailableDate,
        estimatedWaitDays: merged.estimatedWaitDays,
        acceptingVerifiedAt: merged.acceptingVerifiedAt,
        schedulingVerifiedAt: merged.schedulingVerifiedAt,
        lastVerifiedAt: merged.lastVerifiedAt,
      } : {}),
      optimisticLockVersion: survivor.optimisticLockVersion + 1,
      updatedAt: new Date(),
    }).where(and(eq(facilities.id, survivor.id), eq(facilities.optimisticLockVersion, value.survivorExpectedVersion))).returning();
    const [archived] = await tx.update(facilities).set({
      active: false,
      dataQualityStatus: 'clean',
      mergedIntoFacilityId: survivor.id,
      archivedAt: new Date(),
      archivedBy: principal.id,
      optimisticLockVersion: merged.optimisticLockVersion + 1,
      updatedAt: new Date(),
    }).where(and(eq(facilities.id, merged.id), eq(facilities.optimisticLockVersion, value.mergedExpectedVersion))).returning();
    if (!updatedSurvivor || !archived) throw new RecordConflictError();
    const [mergeRecord] = await tx.insert(facilityMergeRecords).values({
      survivorFacilityId: survivor.id,
      mergedFacilityId: merged.id,
      candidateId: value.candidateId ?? null,
      mergedBy: principal.id,
      reason: value.reason,
      restoreSnapshot: {
        survivorVersion: survivor.optimisticLockVersion,
        mergedVersion: merged.optimisticLockVersion,
        mergedWasActive: merged.active,
        copiedSpecialtyIds,
        copiedDiagnosisIds,
      },
    }).returning();
    if (value.candidateId) {
      await tx.update(facilityDuplicateCandidates).set({
        decision: 'merged', reviewedBy: principal.id, reviewedAt: new Date(), updatedAt: new Date(),
      }).where(eq(facilityDuplicateCandidates.id, value.candidateId));
    }
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id, action: 'facility.merge', result: 'success', entityType: 'facility_merge', entityId: mergeRecord.id,
      request, metadata: { survivorFacilityId: survivor.id, mergedFacilityId: merged.id, copiedSpecialties: copiedSpecialtyIds.length, copiedDiagnoses: copiedDiagnosisIds.length },
    }));
    return { mergeRecord, survivor: updatedSurvivor, archived };
  });
}

export async function bulkAssignReverification(
  principal: Principal,
  input: z.infer<typeof bulkAssignmentInputSchema>,
  request?: Request,
) {
  assertPermission(principal, 'admin:manage-data');
  const value = bulkAssignmentInputSchema.parse(input);
  const facilityIds = [...new Set(value.facilityIds)];
  const db = requireDatabaseClient();
  return db.transaction(async (tx) => {
    const active = await tx.select({ id: facilities.id }).from(facilities)
      .where(and(inArray(facilities.id, facilityIds), eq(facilities.active, true)));
    if (active.length !== facilityIds.length) throw new RecordConflictError('One or more selected facilities are missing or inactive. No assignments were changed.');
    const open = await tx.select({ facilityId: reverificationAssignments.facilityId }).from(reverificationAssignments)
      .where(and(inArray(reverificationAssignments.facilityId, facilityIds), eq(reverificationAssignments.status, 'open')));
    const openIds = new Set(open.map((item) => item.facilityId));
    if (open.length) {
      await tx.update(reverificationAssignments).set({
        assignedTo: value.assignedTo, assignedBy: principal.id, reasonCodes: value.reasonCodes, updatedAt: new Date(),
      }).where(and(inArray(reverificationAssignments.facilityId, [...openIds]), eq(reverificationAssignments.status, 'open')));
    }
    const newIds = facilityIds.filter((id) => !openIds.has(id));
    if (newIds.length) await tx.insert(reverificationAssignments).values(newIds.map((facilityId) => ({
      facilityId, assignedTo: value.assignedTo, assignedBy: principal.id, reasonCodes: value.reasonCodes,
    })));
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id, action: 'reverification.bulk-assign', result: 'success', entityType: 'reverification_assignment',
      request, metadata: { selectedCount: facilityIds.length, assignedTo: value.assignedTo },
    }));
    return { assignedCount: facilityIds.length };
  });
}

export async function getFacilityDetail(principal: Principal, facilityId: string) {
  assertPermission(principal, 'operations:read');
  const id = facilityIdSchema.parse(facilityId);
  const db = requireDatabaseClient();
  const [facility] = await db.select().from(facilities).where(eq(facilities.id, id)).limit(1);
  if (!facility) return null;
  const mergedIds = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.mergedIntoFacilityId, facility.id));
  const historyIds = [facility.id, ...mergedIds.map((item) => item.id)];
  const [specialtyRows, diagnosisRows, verificationRows, contactRows, duplicateRows] = await Promise.all([
    db.select({ id: facilitySpecialties.id, specialtyId: specialties.id, name: specialties.canonicalName, status: facilitySpecialties.verificationStatus, active: facilitySpecialties.active, lastVerifiedAt: facilitySpecialties.lastConfirmedAt, notes: facilitySpecialties.notes })
      .from(facilitySpecialties).innerJoin(specialties, eq(facilitySpecialties.specialtyId, specialties.id))
      .where(inArray(facilitySpecialties.facilityId, historyIds)).orderBy(specialties.canonicalName),
    db.select({ id: facilityDiagnosisCapabilities.id, diagnosisId: diagnoses.id, code: diagnoses.code, description: diagnoses.description, status: facilityDiagnosisCapabilities.status, active: facilityDiagnosisCapabilities.active, lastVerifiedAt: facilityDiagnosisCapabilities.lastVerifiedAt, notes: facilityDiagnosisCapabilities.notes })
      .from(facilityDiagnosisCapabilities).innerJoin(diagnoses, eq(facilityDiagnosisCapabilities.diagnosisId, diagnoses.id))
      .where(inArray(facilityDiagnosisCapabilities.facilityId, historyIds)).orderBy(diagnoses.code),
    db.select({
      id: facilityVerificationEvents.id,
      facilityId: facilityVerificationEvents.facilityId,
      verifiedAt: facilityVerificationEvents.verifiedAt,
      verifiedBy: facilityVerificationEvents.verifiedBy,
      actorName: sql<string | null>`coalesce(${users.displayName}, ${users.name})`,
      method: facilityVerificationEvents.method,
      confidence: facilityVerificationEvents.confidence,
      contactPerson: facilityVerificationEvents.contactPerson,
      acceptingStatus: facilityVerificationEvents.acceptingStatus,
      specialtyStatus: facilityVerificationEvents.specialtyStatus,
      diagnosisStatus: facilityVerificationEvents.diagnosisStatus,
      schedulingWithinFourWeeks: facilityVerificationEvents.schedulingWithinFourWeeks,
      urgentReferralStatus: facilityVerificationEvents.urgentReferralStatus,
      nextAvailableDate: facilityVerificationEvents.nextAvailableDate,
      estimatedWaitDays: facilityVerificationEvents.estimatedWaitDays,
      comments: facilityVerificationEvents.comments,
      previousState: facilityVerificationEvents.previousState,
      resultingState: facilityVerificationEvents.resultingState,
      relatedCallId: facilityVerificationEvents.relatedCallId,
    }).from(facilityVerificationEvents).leftJoin(users, eq(facilityVerificationEvents.verifiedBy, users.id))
      .where(inArray(facilityVerificationEvents.facilityId, historyIds))
      .orderBy(desc(facilityVerificationEvents.verifiedAt)).limit(100),
    db.select({
      id: facilityContactAttempts.id,
      facilityId: facilityContactAttempts.facilityId,
      attemptedAt: facilityContactAttempts.attemptedAt,
      attemptedBy: facilityContactAttempts.attemptedBy,
      actorName: sql<string | null>`coalesce(${users.displayName}, ${users.name})`,
      method: facilityContactAttempts.method,
      outcome: facilityContactAttempts.outcome,
      contactPerson: facilityContactAttempts.contactPerson,
      contactChannel: facilityContactAttempts.contactChannel,
      comments: facilityContactAttempts.comments,
      relatedCallId: facilityContactAttempts.relatedCallId,
    }).from(facilityContactAttempts).leftJoin(users, eq(facilityContactAttempts.attemptedBy, users.id))
      .where(inArray(facilityContactAttempts.facilityId, historyIds))
      .orderBy(desc(facilityContactAttempts.attemptedAt)).limit(100),
    db.select().from(facilityDuplicateCandidates).where(and(
      sql`${facilityDuplicateCandidates.decision} in ('pending', 'deferred')`,
      sql`(${facilityDuplicateCandidates.leftFacilityId} = ${facility.id} or ${facilityDuplicateCandidates.rightFacilityId} = ${facility.id})`,
    )).orderBy(desc(facilityDuplicateCandidates.score)),
  ]);
  return { facility, specialties: specialtyRows, diagnoses: diagnosisRows, verifications: verificationRows, contacts: contactRows, duplicateCandidates: duplicateRows };
}

export async function listFacilityReferenceOptions(principal: Principal) {
  assertPermission(principal, 'operations:read');
  const db = requireDatabaseClient();
  const [specialtyRows, diagnosisRows] = await Promise.all([
    db.select({ id: specialties.id, label: specialties.canonicalName }).from(specialties)
      .where(eq(specialties.active, true)).orderBy(specialties.canonicalName),
    db.select({ id: diagnoses.id, code: diagnoses.code, description: diagnoses.description }).from(diagnoses)
      .where(eq(diagnoses.active, true)).orderBy(diagnoses.code),
  ]);
  return {
    specialties: specialtyRows,
    diagnoses: diagnosisRows.map((row) => ({ id: row.id, label: `${row.code} · ${row.description}` })),
  };
}

export function providerServiceErrorResponse(error: unknown): Response | null {
  if (error instanceof RecordConflictError || error instanceof RecordNotFoundError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}
