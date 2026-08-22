import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  accessReviewDecisions,
  auditEvents,
  dataRetentionHolds,
  dataRetentionPolicies,
  sessions,
  users,
} from '@/db/schema';
import {
  accessReviewDecisionValues,
  currentReviewPeriod,
  isDormantAccount,
  retentionCategories,
} from '@/lib/governance';
import { assertPermission, assertRecentAuthentication, type Principal } from './authorization';
import { buildAuditEvent, recordAuditEventBestEffort } from './audit';
import { getServerConfig } from './config';
import { getDatabasePool, requireDatabaseClient } from './database';

const uuidSchema = z.string().uuid();
const reviewPeriodSchema = z.string().regex(/^[0-9]{4}-Q[1-4]$/);
const retentionCategorySchema = z.enum(retentionCategories.map((category) => category.key));
const safeCodeSchema = z.string().trim().min(2).max(80).regex(/^[a-z][a-z0-9_]*$/);

export const accessReviewInputSchema = z.object({
  reviewedUserId: uuidSchema,
  reviewPeriod: reviewPeriodSchema,
  decision: z.enum(accessReviewDecisionValues),
}).strict();

export const retentionPolicyInputSchema = z.object({
  category: retentionCategorySchema,
  retentionDays: z.number().int().min(1).max(36_500).nullable(),
  deletionEnabled: z.boolean(),
  policyReference: z.string().trim().min(3).max(200).nullable(),
  confirmation: z.string().optional(),
}).strict().superRefine((value, context) => {
  if (!value.deletionEnabled) return;
  if (!value.retentionDays || !value.policyReference) {
    context.addIssue({ code: 'custom', message: 'Enabled deletion requires a retention period and approved policy reference.' });
  }
  if (value.confirmation !== 'ENABLE RETENTION') {
    context.addIssue({ code: 'custom', path: ['confirmation'], message: 'Type ENABLE RETENTION to enable deletion.' });
  }
});

export const retentionHoldInputSchema = z.object({
  category: retentionCategorySchema,
  entityType: safeCodeSchema.nullable().default(null),
  entityId: z.string().trim().min(1).max(200).nullable().default(null),
  reasonCode: safeCodeSchema,
}).strict().refine((value) => Boolean(value.entityType) === Boolean(value.entityId), {
  message: 'Entity type and entity ID must be supplied together.',
});

export const retentionDryRunInputSchema = z.object({
  category: retentionCategorySchema,
  asOf: z.string().datetime({ offset: true }).optional(),
}).strict();

export const retentionHoldReleaseInputSchema = z.object({
  reasonCode: safeCodeSchema,
}).strict();

export const incidentScopeInputSchema = z.object({
  userId: uuidSchema,
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
}).strict().refine((value) => new Date(value.start) <= new Date(value.end), {
  path: ['start'],
  message: 'Start time must be on or before end time.',
}).refine((value) => new Date(value.end).getTime() - new Date(value.start).getTime() <= 366 * 86_400_000, {
  path: ['end'],
  message: 'Investigation windows are limited to 366 days.',
});

export async function listAccessReviewAccounts(principal: Principal) {
  assertPermission(principal, 'governance:read');
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database configuration is required for access review.');
  const dormantDays = getServerConfig().GOVERNANCE_DORMANT_ACCOUNT_DAYS;
  const result = await pool.query<{
    id: string;
    name: string;
    email: string;
    role: Principal['role'];
    is_active: boolean;
    created_at: Date;
    last_signed_in_at: Date | null;
    role_assigned_at: Date | null;
    last_security_action_at: Date | null;
    recent_security_actions: number;
    latest_review_period: string | null;
    latest_review_decision: string | null;
    latest_reviewed_at: Date | null;
  }>(`
    SELECT u.id, coalesce(u.display_name,u.name) AS name, u.email, u.role, u.is_active,
      u.created_at, u.last_signed_in_at, u.role_assigned_at,
      max(a.created_at) FILTER (WHERE a.action ~ '^(user|access-review|security|retention|export|migration|automation\\.settings)') AS last_security_action_at,
      count(a.id) FILTER (WHERE a.created_at >= now()-interval '90 days'
        AND a.action ~ '^(user|access-review|security|retention|export|migration|automation\\.settings)')::int AS recent_security_actions,
      latest.review_period AS latest_review_period,
      latest.decision::text AS latest_review_decision,
      latest.decided_at AS latest_reviewed_at
    FROM users u
    LEFT JOIN audit_events a ON a.actor_id=u.id
    LEFT JOIN LATERAL (
      SELECT review_period,decision,decided_at FROM access_review_decisions
      WHERE reviewed_user_id=u.id ORDER BY decided_at DESC LIMIT 1
    ) latest ON true
    WHERE u.is_service_account=false
    GROUP BY u.id,latest.review_period,latest.decision,latest.decided_at
    ORDER BY (u.role='admin') DESC,u.is_active DESC,name,u.email`);

  const now = new Date();
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    lastSignedInAt: row.last_signed_in_at,
    roleAssignedAt: row.role_assigned_at,
    privileged: row.role === 'admin',
    dormant: isDormantAccount({
      active: row.is_active,
      lastSignedInAt: row.last_signed_in_at,
      createdAt: row.created_at,
    }, dormantDays, now),
    dormantDays,
    lastSecurityActionAt: row.last_security_action_at,
    recentSecurityActions: row.recent_security_actions,
    latestReview: row.latest_review_period ? {
      period: row.latest_review_period,
      decision: row.latest_review_decision,
      decidedAt: row.latest_reviewed_at,
    } : null,
  }));
}

export async function recordAccessReviewDecision(
  principal: Principal,
  rawInput: unknown,
  request: Request,
) {
  assertPermission(principal, 'governance:manage');
  assertRecentAuthentication(principal);
  const input = accessReviewInputSchema.parse(rawInput);
  const db = requireDatabaseClient();
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({
        id: users.id,
        role: users.role,
        isActive: users.isActive,
        lastSignedInAt: users.lastSignedInAt,
        isServiceAccount: users.isServiceAccount,
      })
      .from(users)
      .where(eq(users.id, input.reviewedUserId))
      .limit(1);
    if (!target || target.isServiceAccount) return null;

    const [decision] = await tx.insert(accessReviewDecisions).values({
      reviewPeriod: input.reviewPeriod,
      reviewedUserId: target.id,
      reviewerId: principal.id,
      reviewedRole: target.role,
      accountActive: target.isActive,
      lastSignedInAt: target.lastSignedInAt,
      decision: input.decision,
      decidedAt: new Date(),
    }).onConflictDoUpdate({
      target: [
        accessReviewDecisions.reviewPeriod,
        accessReviewDecisions.reviewedUserId,
        accessReviewDecisions.reviewerId,
      ],
      set: {
        reviewedRole: target.role,
        accountActive: target.isActive,
        lastSignedInAt: target.lastSignedInAt,
        decision: input.decision,
        decidedAt: new Date(),
      },
    }).returning();

    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'access-review.decision',
      result: 'success',
      entityType: 'user',
      entityId: target.id,
      request,
      metadata: {
        reviewPeriod: input.reviewPeriod,
        reviewedRole: target.role,
        decision: input.decision,
      },
    }));
    return decision;
  });
}

export async function listRetentionState(principal: Principal) {
  assertPermission(principal, 'governance:read');
  const db = requireDatabaseClient();
  const [policies, holds] = await Promise.all([
    db.select().from(dataRetentionPolicies).orderBy(dataRetentionPolicies.category),
    db.select({
      id: dataRetentionHolds.id,
      category: dataRetentionHolds.category,
      entityType: dataRetentionHolds.entityType,
      entityId: dataRetentionHolds.entityId,
      reasonCode: dataRetentionHolds.reasonCode,
      placedAt: dataRetentionHolds.placedAt,
      releasedAt: dataRetentionHolds.releasedAt,
    }).from(dataRetentionHolds).orderBy(desc(dataRetentionHolds.placedAt)).limit(200),
  ]);
  const byCategory = new Map(policies.map((policy) => [policy.category, policy]));
  return {
    policies: retentionCategories.map((category) => ({
      ...category,
      retentionDays: byCategory.get(category.key)?.retentionDays ?? null,
      deletionEnabled: byCategory.get(category.key)?.deletionEnabled ?? false,
      policyReference: byCategory.get(category.key)?.policyReference ?? null,
      approvedAt: byCategory.get(category.key)?.approvedAt ?? null,
      updatedAt: byCategory.get(category.key)?.updatedAt ?? null,
    })),
    holds,
  };
}

export async function saveRetentionPolicy(
  principal: Principal,
  rawInput: unknown,
  request: Request,
) {
  assertPermission(principal, 'governance:manage');
  assertRecentAuthentication(principal);
  const input = retentionPolicyInputSchema.parse(rawInput);
  const db = requireDatabaseClient();
  return db.transaction(async (tx) => {
    const [previous] = await tx.select().from(dataRetentionPolicies).where(eq(dataRetentionPolicies.category, input.category)).limit(1);
    const now = new Date();
    const [saved] = await tx.insert(dataRetentionPolicies).values({
      category: input.category,
      retentionDays: input.retentionDays,
      deletionEnabled: input.deletionEnabled,
      policyReference: input.policyReference,
      approvedBy: input.deletionEnabled ? principal.id : null,
      approvedAt: input.deletionEnabled ? now : null,
      updatedBy: principal.id,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: dataRetentionPolicies.category,
      set: {
        retentionDays: input.retentionDays,
        deletionEnabled: input.deletionEnabled,
        policyReference: input.policyReference,
        approvedBy: input.deletionEnabled ? principal.id : null,
        approvedAt: input.deletionEnabled ? now : null,
        updatedBy: principal.id,
        updatedAt: now,
      },
    }).returning();
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'retention.policy-update',
      result: 'success',
      entityType: 'retention_policy',
      entityId: input.category,
      request,
      metadata: {
        previousDays: previous?.retentionDays ?? null,
        newDays: input.retentionDays,
        previousEnabled: previous?.deletionEnabled ?? false,
        newEnabled: input.deletionEnabled,
        policyReference: input.policyReference,
      },
    }));
    return saved;
  });
}

export async function placeRetentionHold(principal: Principal, rawInput: unknown, request: Request) {
  assertPermission(principal, 'governance:manage');
  assertRecentAuthentication(principal);
  const input = retentionHoldInputSchema.parse(rawInput);
  const db = requireDatabaseClient();
  return db.transaction(async (tx) => {
    const [hold] = await tx.insert(dataRetentionHolds).values({
      ...input,
      placedBy: principal.id,
    }).returning();
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'retention.hold-place',
      result: 'success',
      entityType: 'retention_hold',
      entityId: hold.id,
      request,
      metadata: { category: input.category, scoped: Boolean(input.entityId), reasonCode: input.reasonCode },
    }));
    return hold;
  });
}

export async function releaseRetentionHold(principal: Principal, holdId: string, rawInput: unknown, request: Request) {
  assertPermission(principal, 'governance:manage');
  assertRecentAuthentication(principal);
  const id = uuidSchema.parse(holdId);
  const input = retentionHoldReleaseInputSchema.parse(rawInput);
  const db = requireDatabaseClient();
  return db.transaction(async (tx) => {
    const [released] = await tx.update(dataRetentionHolds).set({
      releasedBy: principal.id,
      releasedAt: new Date(),
    }).where(and(eq(dataRetentionHolds.id, id), isNull(dataRetentionHolds.releasedAt))).returning();
    if (!released) return null;
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'retention.hold-release',
      result: 'success',
      entityType: 'retention_hold',
      entityId: id,
      request,
      metadata: { category: released.category, reasonCode: input.reasonCode },
    }));
    return released;
  });
}

export async function retentionDryRun(principal: Principal, rawInput: unknown, request?: Request) {
  assertPermission(principal, 'governance:manage');
  const input = retentionDryRunInputSchema.parse(rawInput);
  const definition = retentionCategories.find((category) => category.key === input.category)!;
  const db = requireDatabaseClient();
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database configuration is required for retention review.');
  const [policy] = await db.select().from(dataRetentionPolicies).where(eq(dataRetentionPolicies.category, input.category)).limit(1);
  if (!policy?.retentionDays) {
    return {
      category: input.category,
      configured: false,
      deletionEnabled: false,
      eligibleRecords: 0,
      heldRecords: 0,
      cutoff: null,
      dependencies: [],
      mode: 'dry-run' as const,
    };
  }
  const asOf = input.asOf ? new Date(input.asOf) : new Date();
  const cutoff = new Date(asOf.getTime() - policy.retentionDays * 86_400_000);
  const datePredicate = `target."${definition.dateColumn}" < $1`;
  const parameters = definition.key === 'inactive_rate_limit_buckets'
    ? [String(cutoff.getTime()), input.category, definition.table]
    : [cutoff, input.category, definition.table];
  const counts = await pool.query<{ eligible: number; held: number }>(`
    SELECT
      count(*) FILTER (WHERE ${datePredicate} AND NOT EXISTS (
        SELECT 1 FROM data_retention_holds hold
        WHERE hold.category=$2 AND hold.released_at IS NULL
          AND (hold.entity_id IS NULL OR (hold.entity_type=$3 AND hold.entity_id=target.id::text))
      ))::int AS eligible,
      count(*) FILTER (WHERE ${datePredicate} AND EXISTS (
        SELECT 1 FROM data_retention_holds hold
        WHERE hold.category=$2 AND hold.released_at IS NULL
          AND (hold.entity_id IS NULL OR (hold.entity_type=$3 AND hold.entity_id=target.id::text))
      ))::int AS held
    FROM "${definition.table}" target`, parameters);
  const result = {
    category: input.category,
    configured: true,
    deletionEnabled: policy.deletionEnabled,
    eligibleRecords: counts.rows[0]?.eligible ?? 0,
    heldRecords: counts.rows[0]?.held ?? 0,
    cutoff: cutoff.toISOString(),
    dependencies: [],
    mode: 'dry-run' as const,
  };
  await recordAuditEventBestEffort({
    actorId: principal.id,
    action: 'retention.dry-run',
    result: 'success',
    entityType: 'retention_policy',
    entityId: input.category,
    request,
    metadata: {
      eligibleRecords: result.eligibleRecords,
      heldRecords: result.heldRecords,
      deletionEnabled: result.deletionEnabled,
    },
  });
  return result;
}

const securityActionPattern = /^(auth\.|authorization\.denied|user\.|account\.|access-review\.|retention\.|export\.|migration\.|automation\.settings|security\.|audit\.)/;

export async function listSecurityTimeline(principal: Principal) {
  assertPermission(principal, 'security:investigate');
  const rows = await requireDatabaseClient()
    .select({
      id: auditEvents.id,
      actorId: auditEvents.actorId,
      action: auditEvents.action,
      result: auditEvents.result,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt))
    .limit(500);
  return rows.filter((row) => securityActionPattern.test(row.action)).slice(0, 100);
}

export async function investigateAccount(
  principal: Principal,
  rawInput: unknown,
  request: Request,
) {
  assertPermission(principal, 'security:investigate');
  const input = incidentScopeInputSchema.parse(rawInput);
  const db = requireDatabaseClient();
  const [target] = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    isActive: users.isActive,
    lastSignedInAt: users.lastSignedInAt,
  }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!target) return null;
  const start = new Date(input.start);
  const end = new Date(input.end);
  const maximum = getServerConfig().GOVERNANCE_INCIDENT_MAX_EVENTS;
  const [eventRows, sessionRows] = await Promise.all([
    db.select({
      action: auditEvents.action,
      result: auditEvents.result,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      createdAt: auditEvents.createdAt,
    }).from(auditEvents).where(and(
      eq(auditEvents.actorId, input.userId),
      sql`${auditEvents.createdAt} >= ${start}`,
      sql`${auditEvents.createdAt} <= ${end}`,
    )).orderBy(desc(auditEvents.createdAt)).limit(maximum + 1),
    db.select({
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.updatedAt,
      expiresAt: sessions.expiresAt,
    }).from(sessions).where(eq(sessions.userId, input.userId)).orderBy(desc(sessions.createdAt)).limit(100),
  ]);
  const truncated = eventRows.length > maximum;
  const events = eventRows.slice(0, maximum);
  const count = (predicate: (action: string, result: string) => boolean) =>
    events.filter((event) => predicate(event.action, event.result)).length;
  const result = {
    subject: target,
    period: { start: start.toISOString(), end: end.toISOString() },
    summary: {
      signIns: count((action, resultValue) => action === 'auth.sign-in' && resultValue === 'success'),
      failedSignIns: count((action, resultValue) => action === 'auth.sign-in' && resultValue === 'failure'),
      authorizationFailures: count((action) => action === 'authorization.denied'),
      searches: count((action) => action === 'provider.search'),
      reports: count((action) => action === 'report.view'),
      exports: count((action) => action.startsWith('export.') || action.endsWith('.export')),
      privilegedActions: count((action) => securityActionPattern.test(action)),
      mutations: count((action, resultValue) => resultValue === 'success' && /(?:create|update|change|delete|merge|assign|resolve|revoke|disable|deactivate)/.test(action)),
      currentSessions: sessionRows.length,
    },
    sessions: sessionRows,
    events,
    truncated,
    eventLimit: maximum,
    evidenceLimitations: [
      'Normal database reads are not logged individually.',
      'Provider searches and reports record the action and result count, not query values or every returned row.',
      'Expired or revoked sessions may already have been removed under approved retention policy.',
      'Proxy, identity-provider, database, and infrastructure logs must be reviewed separately.',
      'This report is an investigation aid and does not determine legal breach scope.',
    ],
  };
  await recordAuditEventBestEffort({
    actorId: principal.id,
    action: 'security.investigation.run',
    result: 'success',
    entityType: 'user',
    entityId: input.userId,
    request,
    metadata: { eventCount: events.length, truncated },
  });
  return result;
}

export function phase10PolicySnapshot(input: {
  retentionPolicies: Array<{ deletionEnabled: boolean; retentionDays: number | null }>;
}) {
  const config = getServerConfig();
  return {
    generatedAt: new Date().toISOString(),
    vpnRequired: process.env.NETWORK_ACCESS_MODE === 'private-vpn',
    mfaRequired: process.env.CORPORATE_MFA_REQUIRED === 'true',
    retentionConfigured: input.retentionPolicies.some((policy) => policy.retentionDays !== null),
    destructiveRetentionEnabled: input.retentionPolicies.some((policy) => policy.deletionEnabled),
    exportAuditEnabled: true,
    exportMaxRows: config.EXPORT_MAX_ROWS,
    dormantAccountReviewDays: config.GOVERNANCE_DORMANT_ACCOUNT_DAYS,
    securityLoggingEnabled: true,
    maintenanceMode: config.APP_MAINTENANCE_MODE,
  };
}

export { currentReviewPeriod };
