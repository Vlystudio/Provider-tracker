import 'server-only';

import { and, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { auditEvents, users } from '@/db/schema';
import { assertPermission, type Principal } from './authorization';
import { recordAuditEventBestEffort } from './audit';
import { requireDatabaseClient } from './database';

export const auditLogFilterSchema = z.object({
  actor: z.string().trim().max(100).optional().default(''),
  action: z.string().trim().max(100).optional().default(''),
  result: z.enum(['', 'success', 'failure', 'blocked']).optional().default(''),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export type AuditLogFilters = z.infer<typeof auditLogFilterSchema>;

export async function listAuditEvents(principal: Principal, input: unknown) {
  assertPermission(principal, 'audit:read');
  const filters = auditLogFilterSchema.parse(input);
  const conditions = [];

  if (filters.actor) {
    conditions.push(or(ilike(users.name, `%${filters.actor}%`), ilike(users.email, `%${filters.actor}%`))!);
  }
  if (filters.action) conditions.push(ilike(auditEvents.action, `%${filters.action}%`));
  if (filters.result) conditions.push(eq(auditEvents.result, filters.result));
  if (filters.from) conditions.push(gte(auditEvents.createdAt, new Date(`${filters.from}T00:00:00.000Z`)));
  if (filters.to) conditions.push(lte(auditEvents.createdAt, new Date(`${filters.to}T23:59:59.999Z`)));

  const rows = await requireDatabaseClient()
    .select({
      id: auditEvents.id,
      actorName: users.name,
      actorEmail: users.email,
      action: auditEvents.action,
      result: auditEvents.result,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .leftJoin(users, eq(auditEvents.actorId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditEvents.createdAt))
    .limit(100);

  const filterKeys = Object.entries(filters).filter(([, value]) => Boolean(value)).map(([key]) => key).sort();
  if (filterKeys.length) {
    await recordAuditEventBestEffort({
      actorId: principal.id,
      action: 'audit.search',
      result: 'success',
      entityType: 'audit_event',
      metadata: { filterKeys: filterKeys.join(','), resultCount: rows.length },
    });
  }
  return { filters, rows };
}
