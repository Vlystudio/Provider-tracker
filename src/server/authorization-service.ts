import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auditEvents, authorizations } from '@/db/schema';
import { assertPermission, type Principal } from './authorization';
import { buildAuditEvent } from './audit';
import { requireDatabaseClient } from './database';

export const authorizationIdSchema = z.string().uuid();
export const authorizationPatchSchema = z
  .object({
    status: z.enum(['open', 'complete', 'cancelled']).optional(),
    memberZip: z.string().regex(/^\d{5}$/).nullable().optional(),
    referralReasonDetail: z.string().trim().max(1000).nullable().optional(),
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
  authorizationNumber: authorizations.authorizationNumber,
  memberZip: authorizations.memberZip,
  status: authorizations.status,
  referralReasonDetail: authorizations.referralReasonDetail,
  createdBy: authorizations.createdBy,
  createdAt: authorizations.createdAt,
  updatedAt: authorizations.updatedAt,
};

export async function getAuthorizationForPrincipal(principal: Principal, id: string) {
  assertPermission(principal, 'operations:read');
  const [record] = await requireDatabaseClient()
    .select(publicAuthorizationFields)
    .from(authorizations)
    .where(authorizationScope(principal, id))
    .limit(1);
  return record ?? null;
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
    return record;
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
