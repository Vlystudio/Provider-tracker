import 'server-only';

import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auditEvents, authorizations } from '@/db/schema';
import { formatTrackingId } from '@/lib/tracking-id';
import { assertPermission, type Principal } from './authorization';
import { buildAuditEvent } from './audit';
import { requireDatabaseClient } from './database';

export const authorizationIdSchema = z.string().uuid();
export const authorizationPatchSchema = z
  .object({
    status: z.enum(['open', 'complete', 'cancelled']).optional(),
    memberZip: z.string().regex(/^\d{5}$/).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one supported field is required.');

function authorizationScope(principal: Principal, id: string) {
  return principal.role === 'admin'
    ? eq(authorizations.id, id)
    : and(eq(authorizations.id, id), eq(authorizations.createdBy, principal.id));
}

const publicAuthorizationFields = {
  id: authorizations.id,
  memberZip: authorizations.memberZip,
  status: authorizations.status,
  createdBy: authorizations.createdBy,
  createdAt: authorizations.createdAt,
  updatedAt: authorizations.updatedAt,
};

type PublicAuthorizationRecord = {
  id: string;
  memberZip: string | null;
  status: 'open' | 'complete' | 'cancelled';
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toPublicAuthorization(record: PublicAuthorizationRecord) {
  return { ...record, trackingId: formatTrackingId(record.id) };
}

export async function getAuthorizationForPrincipal(principal: Principal, id: string) {
  assertPermission(principal, 'operations:read');
  const [record] = await requireDatabaseClient()
    .select(publicAuthorizationFields)
    .from(authorizations)
    .where(authorizationScope(principal, id))
    .limit(1);
  return record ? toPublicAuthorization(record) : null;
}

export async function listAuthorizationsForPrincipal(principal: Principal) {
  assertPermission(principal, 'operations:read');
  const query = requireDatabaseClient()
    .select(publicAuthorizationFields)
    .from(authorizations);

  const records = principal.role === 'admin'
    ? query.orderBy(desc(authorizations.updatedAt)).limit(100)
    : query
        .where(eq(authorizations.createdBy, principal.id))
        .orderBy(desc(authorizations.updatedAt))
        .limit(100);
  return (await records).map(toPublicAuthorization);
}

export async function updateAuthorizationForPrincipal(
  principal: Principal,
  id: string,
  patch: z.infer<typeof authorizationPatchSchema>,
  request: Request,
) {
  assertPermission(principal, 'operations:write');
  const db = requireDatabaseClient();

  return db.transaction(async (tx) => {
    const [record] = await tx
      .update(authorizations)
      .set({ ...patch, updatedAt: new Date() })
      .where(authorizationScope(principal, id))
      .returning(publicAuthorizationFields);

    if (!record) return null;
    await tx.insert(auditEvents).values(
      buildAuditEvent({
        actorId: principal.id,
        action: 'authorization.update',
        result: 'success',
        entityType: 'authorization',
        entityId: id,
        request,
        metadata: { changedFieldCount: Object.keys(patch).length },
      }),
    );
    return toPublicAuthorization(record);
  });
}

export async function deleteAuthorizationForPrincipal(principal: Principal, id: string, request: Request) {
  assertPermission(principal, 'admin:manage-data');
  const db = requireDatabaseClient();

  return db.transaction(async (tx) => {
    const [record] = await tx
      .delete(authorizations)
      .where(eq(authorizations.id, id))
      .returning({ id: authorizations.id });
    if (!record) return false;

    await tx.insert(auditEvents).values(
      buildAuditEvent({
        actorId: principal.id,
        action: 'authorization.delete',
        result: 'success',
        entityType: 'authorization',
        entityId: id,
        request,
      }),
    );
    return true;
  });
}
