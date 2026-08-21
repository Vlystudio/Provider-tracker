import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { notificationPreferences, notifications } from '@/db/schema';
import { notificationSeverities, severityMeetsMinimum, type NotificationSeverity } from '@/lib/automation';
import type { UserRole } from '@/lib/access-control';
import { recordAuditEvent } from './audit';
import { assertPermission, type Principal } from './authorization';
import { requireDatabaseClient } from './database';
import { incrementMetric } from './metrics';

export const notificationCategories = ['work', 'changes', 'coverage', 'digest', 'audit', 'automation'] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

const roleCategories: Record<UserRole, ReadonlySet<NotificationCategory>> = {
  admin: new Set(notificationCategories),
  ura_user: new Set(['work', 'changes', 'coverage', 'digest']),
  report_viewer: new Set(['changes', 'coverage', 'digest']),
  auditor: new Set(['audit', 'digest']),
};

export const notificationPreferenceInputSchema = z.object({
  inAppEnabled: z.boolean(),
  digestFrequency: z.enum(['none', 'daily', 'weekly']),
  categories: z.array(z.enum(notificationCategories)).max(notificationCategories.length).transform((values) => [...new Set(values)]),
  minimumSeverity: z.enum(notificationSeverities),
});

export const notificationListInputSchema = z.object({
  unreadOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(30),
});

export class NotificationNotFoundError extends Error {
  readonly status = 404;
  constructor() { super('Notification not found.'); }
}

export async function getNotificationPreferences(principal: Principal) {
  assertPermission(principal, 'notifications:read');
  const [stored] = await requireDatabaseClient().select().from(notificationPreferences).where(eq(notificationPreferences.userId, principal.id)).limit(1);
  return stored ?? {
    userId: principal.id,
    inAppEnabled: true,
    digestFrequency: 'daily' as const,
    categories: ['work', 'changes', 'coverage', 'digest'],
    minimumSeverity: 'informational' as const,
    updatedAt: null,
  };
}

export async function saveNotificationPreferences(principal: Principal, value: unknown, request?: Request) {
  assertPermission(principal, 'notifications:read');
  const parsed = notificationPreferenceInputSchema.parse(value);
  const allowedCategories = parsed.categories.filter((category) => roleCategories[principal.role].has(category));
  const [saved] = await requireDatabaseClient().insert(notificationPreferences).values({
    userId: principal.id,
    ...parsed,
    categories: allowedCategories,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: notificationPreferences.userId,
    set: { ...parsed, categories: allowedCategories, updatedAt: new Date() },
  }).returning();
  await recordAuditEvent({
    actorId: principal.id,
    action: 'notification.preferences.update',
    result: 'success',
    entityType: 'notification_preferences',
    entityId: principal.id,
    request,
  });
  return saved;
}

export async function listNotifications(principal: Principal, value: unknown = {}) {
  assertPermission(principal, 'notifications:read');
  const input = notificationListInputSchema.parse(value);
  const ownership = eq(notifications.recipientId, principal.id);
  const where = input.unreadOnly ? and(ownership, isNull(notifications.readAt)) : ownership;
  const rows = await requireDatabaseClient().select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(input.limit);
  const [summary] = await requireDatabaseClient().select({ unreadCount: sql<number>`count(*)::int` }).from(notifications)
    .where(and(ownership, isNull(notifications.readAt)));
  return { rows, unreadCount: summary?.unreadCount ?? 0 };
}

export async function markNotificationRead(principal: Principal, id: string) {
  assertPermission(principal, 'notifications:read');
  const parsedId = z.string().uuid().parse(id);
  const [updated] = await requireDatabaseClient().update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.id, parsedId), eq(notifications.recipientId, principal.id))).returning({ id: notifications.id, readAt: notifications.readAt });
  if (!updated) throw new NotificationNotFoundError();
  return updated;
}

export async function markAllNotificationsRead(principal: Principal) {
  assertPermission(principal, 'notifications:read');
  const changed = await requireDatabaseClient().update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, principal.id), isNull(notifications.readAt))).returning({ id: notifications.id });
  return { updated: changed.length };
}

export type SystemNotificationInput = {
  recipient: { id: string; role: UserRole };
  type: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  targetPath?: string | null;
  source: string;
  deduplicationKey: string;
  issueKey?: string | null;
};

export async function createSystemNotification(input: SystemNotificationInput): Promise<boolean> {
  if (!roleCategories[input.recipient.role].has(input.category)) return false;
  const db = requireDatabaseClient();
  const [preference] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, input.recipient.id)).limit(1);
  if (preference && (!preference.inAppEnabled || !preference.categories.includes(input.category) || !severityMeetsMinimum(input.severity, preference.minimumSeverity))) {
    return false;
  }
  const created = await db.insert(notifications).values({
    recipientId: input.recipient.id,
    type: input.type,
    category: input.category,
    severity: input.severity,
    title: input.title.slice(0, 120),
    message: input.message.slice(0, 300),
    targetPath: input.targetPath ?? null,
    source: input.source,
    deduplicationKey: input.deduplicationKey,
    issueKey: input.issueKey ?? null,
  }).onConflictDoNothing().returning({ id: notifications.id });
  if (created.length) incrementMetric('provider_tracker_notifications_generated_total', { operation: input.category });
  return created.length === 1;
}

export function notificationServiceErrorResponse(error: unknown): Response | null {
  if (error instanceof NotificationNotFoundError) return Response.json({ error: error.message }, { status: error.status });
  return null;
}
