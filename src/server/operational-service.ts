import 'server-only';

import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  automationJobExecutions,
  coverageWatches,
  facilities,
  operationalChangeEvents,
  operationalDigests,
  operationalWorkItems,
  specialties,
  diagnoses,
  users,
} from '@/db/schema';
import { recordAuditEvent } from './audit';
import { assertPermission, type Principal } from './authorization';
import { requireDatabaseClient } from './database';

export class OperationalRecordNotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'The requested item was not found.') { super(message); }
}

export class OperationalConflictError extends Error {
  readonly status = 409;
  constructor() { super('This item changed after you opened it. Refresh and try again.'); }
}

const workListSchema = z.object({
  status: z.enum(['open', 'assigned', 'in_progress', 'completed', 'dismissed', 'blocked']).optional(),
  workType: z.string().trim().max(50).optional(),
  assigned: z.enum(['mine', 'unassigned', 'all']).default('mine'),
  limit: z.number().int().min(1).max(100).default(50),
});

export async function listOperationalWork(principal: Principal, value: unknown = {}) {
  assertPermission(principal, 'work:read');
  const input = workListSchema.parse(value);
  const conditions = [];
  if (input.status) conditions.push(eq(operationalWorkItems.status, input.status));
  else conditions.push(inArray(operationalWorkItems.status, ['open', 'assigned', 'in_progress', 'blocked']));
  if (input.workType) conditions.push(eq(operationalWorkItems.workType, input.workType));
  if (principal.role !== 'admin' || input.assigned === 'mine') conditions.push(eq(operationalWorkItems.assignedTo, principal.id));
  else if (input.assigned === 'unassigned') conditions.push(isNull(operationalWorkItems.assignedTo));
  return requireDatabaseClient().select({
    id: operationalWorkItems.id,
    workType: operationalWorkItems.workType,
    priority: operationalWorkItems.priority,
    targetType: operationalWorkItems.targetType,
    targetId: operationalWorkItems.targetId,
    dueAt: operationalWorkItems.dueAt,
    reasonCodes: operationalWorkItems.reasonCodes,
    status: operationalWorkItems.status,
    assignedTo: operationalWorkItems.assignedTo,
    assignedName: users.displayName,
    source: operationalWorkItems.source,
    cycle: operationalWorkItems.cycle,
    optimisticLockVersion: operationalWorkItems.optimisticLockVersion,
    updatedAt: operationalWorkItems.updatedAt,
    facilityName: facilities.facilityName,
    facilityCity: facilities.city,
  }).from(operationalWorkItems)
    .leftJoin(users, eq(users.id, operationalWorkItems.assignedTo))
    .leftJoin(facilities, and(eq(operationalWorkItems.targetType, 'facility'), eq(facilities.id, operationalWorkItems.targetId)))
    .where(and(...conditions)).orderBy(asc(operationalWorkItems.dueAt), desc(operationalWorkItems.priority), asc(operationalWorkItems.createdAt)).limit(input.limit);
}

export const workItemUpdateSchema = z.object({
  status: z.enum(['open', 'assigned', 'in_progress', 'completed', 'dismissed', 'blocked']),
  assignedTo: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(3).max(300).optional(),
  expectedVersion: z.number().int().min(0),
}).superRefine((value, context) => {
  if (value.status === 'dismissed' && !value.reason) context.addIssue({ code: 'custom', message: 'A dismissal reason is required.', path: ['reason'] });
  if (value.status === 'blocked' && !value.reason) context.addIssue({ code: 'custom', message: 'A blocked reason is required.', path: ['reason'] });
});

export async function updateOperationalWork(principal: Principal, id: string, value: unknown, request?: Request) {
  assertPermission(principal, 'work:write');
  const parsedId = z.string().uuid().parse(id);
  const input = workItemUpdateSchema.parse(value);
  const db = requireDatabaseClient();
  const [before] = await db.select().from(operationalWorkItems).where(eq(operationalWorkItems.id, parsedId)).limit(1);
  if (!before) throw new OperationalRecordNotFoundError();
  const isAdmin = principal.role === 'admin';
  if (!isAdmin && before.assignedTo !== principal.id) throw new OperationalRecordNotFoundError();
  if (!isAdmin && input.assignedTo !== undefined && input.assignedTo !== principal.id) throw new OperationalRecordNotFoundError();
  const now = new Date();
  const assignment = input.assignedTo === undefined ? before.assignedTo : input.assignedTo;
  const [updated] = await db.update(operationalWorkItems).set({
    status: input.status,
    assignedTo: assignment,
    assignedBy: input.assignedTo !== undefined ? principal.id : before.assignedBy,
    blockedReason: input.status === 'blocked' ? input.reason : null,
    completedAt: input.status === 'completed' ? now : null,
    completedBy: input.status === 'completed' ? principal.id : null,
    dismissedAt: input.status === 'dismissed' ? now : null,
    dismissedBy: input.status === 'dismissed' ? principal.id : null,
    dismissalReason: input.status === 'dismissed' ? input.reason : null,
    optimisticLockVersion: before.optimisticLockVersion + 1,
    updatedAt: now,
  }).where(and(eq(operationalWorkItems.id, parsedId), eq(operationalWorkItems.optimisticLockVersion, input.expectedVersion))).returning();
  if (!updated) throw new OperationalConflictError();
  await recordAuditEvent({
    actorId: principal.id,
    action: input.assignedTo !== undefined ? 'work.assignment.update' : 'work.status.update',
    result: 'success',
    entityType: 'operational_work_item',
    entityId: parsedId,
    request,
    metadata: { from: before.status, to: updated.status, assigned: Boolean(updated.assignedTo) },
  });
  return updated;
}

const changeListSchema = z.object({
  query: z.string().trim().max(100).optional(),
  eventType: z.string().trim().max(60).optional(),
  severity: z.enum(['informational', 'attention', 'important']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  facilityId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export async function listOperationalChanges(principal: Principal, value: unknown = {}) {
  assertPermission(principal, 'changes:read');
  const input = changeListSchema.parse(value);
  const conditions = [];
  if (input.eventType) conditions.push(eq(operationalChangeEvents.eventType, input.eventType));
  if (input.severity) conditions.push(eq(operationalChangeEvents.severity, input.severity));
  if (input.from) conditions.push(gte(operationalChangeEvents.occurredAt, input.from));
  if (input.to) conditions.push(lte(operationalChangeEvents.occurredAt, input.to));
  if (input.facilityId) conditions.push(eq(operationalChangeEvents.facilityId, input.facilityId));
  if (input.query) conditions.push(or(ilike(facilities.facilityName, `%${input.query}%`), ilike(facilities.city, `%${input.query}%`))!);
  return requireDatabaseClient().select({
    id: operationalChangeEvents.id,
    eventType: operationalChangeEvents.eventType,
    severity: operationalChangeEvents.severity,
    occurredAt: operationalChangeEvents.occurredAt,
    facilityId: operationalChangeEvents.facilityId,
    facilityName: facilities.facilityName,
    city: facilities.city,
    beforeValue: operationalChangeEvents.beforeValue,
    afterValue: operationalChangeEvents.afterValue,
    specialtyName: specialties.canonicalName,
    diagnosisCode: diagnoses.code,
  }).from(operationalChangeEvents)
    .leftJoin(facilities, eq(facilities.id, operationalChangeEvents.facilityId))
    .leftJoin(specialties, eq(specialties.id, operationalChangeEvents.specialtyId))
    .leftJoin(diagnoses, eq(diagnoses.id, operationalChangeEvents.diagnosisId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(operationalChangeEvents.occurredAt)).limit(input.limit);
}

export async function listCoverageWatches(principal: Principal) {
  assertPermission(principal, 'coverage:read');
  return requireDatabaseClient().select({
    id: coverageWatches.id,
    name: coverageWatches.name,
    specialtyName: specialties.canonicalName,
    diagnosisCode: diagnoses.code,
    postalCode: coverageWatches.postalCode,
    radiusMiles: coverageWatches.radiusMiles,
    minimumCount: coverageWatches.minimumCount,
    freshnessDays: coverageWatches.freshnessDays,
    enabled: coverageWatches.enabled,
    state: coverageWatches.state,
    cycle: coverageWatches.cycle,
    lastCount: coverageWatches.lastCount,
    lastEvaluatedAt: coverageWatches.lastEvaluatedAt,
  }).from(coverageWatches)
    .leftJoin(specialties, eq(specialties.id, coverageWatches.specialtyId))
    .leftJoin(diagnoses, eq(diagnoses.id, coverageWatches.diagnosisId))
    .orderBy(desc(coverageWatches.enabled), asc(coverageWatches.name));
}

export async function listCoverageReferenceOptions(principal: Principal) {
  assertPermission(principal, 'coverage:read');
  const db = requireDatabaseClient();
  const [specialtyRows, diagnosisRows] = await Promise.all([
    db.select({ id: specialties.id, label: specialties.canonicalName }).from(specialties).where(eq(specialties.active, true)).orderBy(asc(specialties.canonicalName)),
    db.select({ id: diagnoses.id, label: sql<string>`${diagnoses.code} || ' - ' || ${diagnoses.description}` }).from(diagnoses).where(eq(diagnoses.active, true)).orderBy(asc(diagnoses.code)),
  ]);
  return { specialties: specialtyRows, diagnoses: diagnosisRows };
}

export const coverageWatchInputSchema = z.object({
  name: z.string().trim().min(3).max(100),
  specialtyId: z.string().uuid().nullable().optional(),
  diagnosisId: z.string().uuid().nullable().optional(),
  postalCode: z.string().regex(/^\d{5}(?:-\d{4})?$/, 'Enter a valid ZIP code.'),
  radiusMiles: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]),
  minimumCount: z.number().int().min(1).max(100),
  freshnessDays: z.number().int().min(1).max(365),
  enabled: z.boolean().default(true),
}).refine((value) => Boolean(value.specialtyId || value.diagnosisId), 'Choose a specialty or diagnosis.');

export async function createCoverageWatch(principal: Principal, value: unknown, request?: Request) {
  assertPermission(principal, 'coverage:manage');
  const input = coverageWatchInputSchema.parse(value);
  const [created] = await requireDatabaseClient().insert(coverageWatches).values({ ...input, createdBy: principal.id }).returning();
  await recordAuditEvent({ actorId: principal.id, action: 'coverage-watch.create', result: 'success', entityType: 'coverage_watch', entityId: created.id, request });
  return created;
}

export async function updateCoverageWatch(principal: Principal, id: string, value: unknown, request?: Request) {
  assertPermission(principal, 'coverage:manage');
  const parsedId = z.string().uuid().parse(id);
  const input = coverageWatchInputSchema.parse(value);
  const [updated] = await requireDatabaseClient().update(coverageWatches).set({ ...input, state: 'unknown', updatedAt: new Date() })
    .where(eq(coverageWatches.id, parsedId)).returning();
  if (!updated) throw new OperationalRecordNotFoundError();
  await recordAuditEvent({ actorId: principal.id, action: 'coverage-watch.update', result: 'success', entityType: 'coverage_watch', entityId: parsedId, request });
  return updated;
}

export async function listOwnDigests(principal: Principal, limit = 20) {
  assertPermission(principal, 'notifications:read');
  return requireDatabaseClient().select().from(operationalDigests).where(eq(operationalDigests.recipientId, principal.id))
    .orderBy(desc(operationalDigests.generatedAt)).limit(Math.max(1, Math.min(limit, 50)));
}

export async function getAutomationHealth(principal: Principal) {
  assertPermission(principal, 'automation:read');
  const db = requireDatabaseClient();
  const recent = await db.select().from(automationJobExecutions).orderBy(desc(automationJobExecutions.startedAt)).limit(50);
  const latestByType = new Map<string, (typeof recent)[number]>();
  for (const execution of recent) if (!latestByType.has(execution.jobType)) latestByType.set(execution.jobType, execution);
  const [summary] = await db.select({
    openWork: sql<number>`count(*) filter (where ${operationalWorkItems.status} in ('open','assigned','in_progress','blocked'))::int`,
    overdueWork: sql<number>`count(*) filter (where ${operationalWorkItems.status} in ('open','assigned','in_progress','blocked') and ${operationalWorkItems.dueAt} < now())::int`,
  }).from(operationalWorkItems);
  const [coverage] = await db.select({ count: sql<number>`count(*)::int` }).from(coverageWatches).where(eq(coverageWatches.state, 'alerting'));
  const [failures] = await db.select({ count: sql<number>`count(*)::int` }).from(automationJobExecutions)
    .where(and(eq(automationJobExecutions.result, 'failed'), gte(automationJobExecutions.startedAt, sql`now() - interval '7 days'`)));
  return {
    latest: [...latestByType.values()],
    recent,
    openWork: summary?.openWork ?? 0,
    overdueWork: summary?.overdueWork ?? 0,
    activeCoverageAlerts: coverage?.count ?? 0,
    failuresLastSevenDays: failures?.count ?? 0,
  };
}

export function operationalServiceErrorResponse(error: unknown): Response | null {
  if (error instanceof OperationalRecordNotFoundError || error instanceof OperationalConflictError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}
