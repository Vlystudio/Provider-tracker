import 'server-only';

import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { accounts, auditEvents, operationalWorkItems, sessions, users } from '@/db/schema';
import { userRoles } from '@/lib/access-control';
import { assertPermission, assertRecentAuthentication, type Principal } from './authorization';
import { buildAuditEvent } from './audit';
import { createTrustedProvisioningAuth } from './auth';
import { requireDatabaseClient } from './database';
import { isCommonPassword } from './password-policy';

export const passwordSchema = z
  .string()
  .min(15)
  .max(128)
  .refine((value) => !isCommonPassword(value), 'Choose a password that is not commonly used.');

export const createUserSchema = z
  .object({
    email: z.string().email().max(254).transform((value) => value.trim().toLowerCase()),
    name: z.string().trim().min(2).max(100),
    password: passwordSchema,
    role: z.enum(userRoles).default('ura_user'),
  })
  .strict();

export const updateUserAccessSchema = z
  .object({
    role: z.enum(userRoles).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one supported field is required.');

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '--';
}

export async function createUserByAdministrator(
  principal: Principal,
  input: z.infer<typeof createUserSchema>,
  request: Request,
) {
  assertPermission(principal, 'admin:manage-users');
  assertRecentAuthentication(principal);
  const db = requireDatabaseClient();
  const provisioningAuth = createTrustedProvisioningAuth();
  const created = await provisioningAuth.api.signUpEmail({
    body: { email: input.email, password: input.password, name: input.name },
  });

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .update(users)
        .set({
          role: input.role,
          roleAssignedAt: new Date(),
          displayName: input.name,
          initials: initialsFor(input.name),
          emailVerified: true,
          isActive: true,
          isServiceAccount: false,
          updatedAt: new Date(),
        })
        .where(eq(users.id, created.user.id))
        .returning({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive });

      await tx.insert(auditEvents).values(
        buildAuditEvent({
          actorId: principal.id,
          action: 'user.create',
          result: 'success',
          entityType: 'user',
          entityId: created.user.id,
          request,
          metadata: { role: input.role },
        }),
      );
      return user;
    });
  } catch (error) {
    await db.delete(users).where(eq(users.id, created.user.id));
    throw error;
  }
}

export async function updateUserAccessByAdministrator(
  principal: Principal,
  targetId: string,
  input: z.infer<typeof updateUserAccessSchema>,
  request: Request,
) {
  assertPermission(principal, 'admin:manage-users');
  assertRecentAuthentication(principal);
  if (principal.id === targetId) {
    throw new Error('Administrators cannot change their own role or activation state.');
  }

  const db = requireDatabaseClient();
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, role: users.role, isActive: users.isActive, isServiceAccount: users.isServiceAccount })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);
    if (!target || target.isServiceAccount) return null;

    const removesAdministratorAccess =
      (input.role !== undefined && input.role !== 'admin') || input.isActive === false;
    if (target.role === 'admin' && removesAdministratorAccess) {
      const [otherAdmin] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, targetId)))
        .limit(1);
      if (!otherAdmin) throw new Error('The last active administrator cannot be removed.');
    }

    const now = new Date();
    const [updated] = await tx
      .update(users)
      .set({
        ...input,
        ...(input.role !== undefined && input.role !== target.role ? { roleAssignedAt: now } : {}),
        ...(input.isActive === false ? { disabledAt: now } : input.isActive === true ? { disabledAt: null } : {}),
        updatedAt: now,
      })
      .where(eq(users.id, targetId))
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive });

    await tx.delete(sessions).where(eq(sessions.userId, targetId));
    await tx.insert(auditEvents).values(
      buildAuditEvent({
        actorId: principal.id,
        action: input.isActive === false ? 'user.deactivate' : input.isActive === true ? 'user.activate' : 'user.role-change',
        result: 'success',
        entityType: 'user',
        entityId: targetId,
        request,
        metadata: {
          previousRole: target.role,
          newRole: input.role ?? target.role,
          previousActive: target.isActive,
          newActive: input.isActive ?? target.isActive,
        },
      }),
    );
    return updated;
  });
}

export async function resetUserPasswordByAdministrator(
  principal: Principal,
  targetId: string,
  newPassword: string,
  request: Request,
) {
  assertPermission(principal, 'admin:manage-users');
  assertRecentAuthentication(principal);
  const password = passwordSchema.parse(newPassword);
  const db = requireDatabaseClient();
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, isServiceAccount: users.isServiceAccount })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);
    if (!target || target.isServiceAccount) return false;

    await tx
      .insert(accounts)
      .values({
        accountId: targetId,
        providerId: 'credential',
        issuer: 'local:credential',
        userId: targetId,
        password: passwordHash,
      })
      .onConflictDoUpdate({
        target: [accounts.issuer, accounts.accountId],
        set: { password: passwordHash, updatedAt: new Date() },
      });
    await tx.delete(sessions).where(eq(sessions.userId, targetId));
    await tx.insert(auditEvents).values(
      buildAuditEvent({
        actorId: principal.id,
        action: 'user.password-reset',
        result: 'success',
        entityType: 'user',
        entityId: targetId,
        request,
      }),
    );
    return true;
  });
}

export async function activeAdministratorCount(): Promise<number> {
  const [row] = await requireDatabaseClient()
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true), eq(users.isServiceAccount, false)));
  return row?.count ?? 0;
}

export async function listUsersForAdministrator(principal: Principal) {
  assertPermission(principal, 'admin:read');
  return requireDatabaseClient()
    .select({
      id: users.id,
      name: users.name,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      lastSignedInAt: users.lastSignedInAt,
      roleAssignedAt: users.roleAssignedAt,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.isServiceAccount, false))
    .orderBy(asc(users.name), asc(users.email));
}

export async function listUserSessionsForAdministrator(principal: Principal, targetId: string) {
  assertPermission(principal, 'admin:manage-users');
  return requireDatabaseClient()
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.updatedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, targetId))
    .orderBy(desc(sessions.updatedAt));
}

export async function listOwnSessions(principal: Principal) {
  const rows = await requireDatabaseClient()
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.updatedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, principal.id))
    .orderBy(desc(sessions.updatedAt));
  return rows.map((row) => ({ ...row, current: row.id === principal.sessionId }));
}

export async function revokeOwnSession(
  principal: Principal,
  sessionId: string,
  request: Request,
) {
  assertRecentAuthentication(principal);
  if (sessionId === principal.sessionId) return false;
  return requireDatabaseClient().transaction(async (tx) => {
    const [removed] = await tx
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, principal.id)))
      .returning({ id: sessions.id });
    if (!removed) return false;
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'account.session-revoke',
      result: 'success',
      entityType: 'session',
      entityId: sessionId,
      request,
    }));
    return true;
  });
}

export async function revokeOwnOtherSessions(principal: Principal, request: Request) {
  assertRecentAuthentication(principal);
  return requireDatabaseClient().transaction(async (tx) => {
    const removed = await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, principal.id), ne(sessions.id, principal.sessionId)))
      .returning({ id: sessions.id });
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'account.sessions-revoke-others',
      result: 'success',
      entityType: 'user',
      entityId: principal.id,
      request,
      metadata: { count: removed.length },
    }));
    return removed.length;
  });
}

export async function revokeUserSessionByAdministrator(
  principal: Principal,
  targetId: string,
  sessionId: string,
  request: Request,
) {
  assertPermission(principal, 'admin:manage-users');
  assertRecentAuthentication(principal);
  return requireDatabaseClient().transaction(async (tx) => {
    const [removed] = await tx
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, targetId)))
      .returning({ id: sessions.id });
    if (!removed) return false;
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'user.session-revoke',
      result: 'success',
      entityType: 'user',
      entityId: targetId,
      request,
      metadata: { sessionId },
    }));
    return true;
  });
}

export async function revokeAllUserSessionsByAdministrator(
  principal: Principal,
  targetId: string,
  request: Request,
) {
  assertPermission(principal, 'admin:manage-users');
  assertRecentAuthentication(principal);
  return requireDatabaseClient().transaction(async (tx) => {
    const removed = await tx
      .delete(sessions)
      .where(eq(sessions.userId, targetId))
      .returning({ id: sessions.id });
    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'user.sessions-revoke-all',
      result: 'success',
      entityType: 'user',
      entityId: targetId,
      request,
      metadata: { count: removed.length },
    }));
    return removed.length;
  });
}

export async function emergencyRevokeUserByAdministrator(
  principal: Principal,
  targetId: string,
  request: Request,
) {
  assertPermission(principal, 'admin:manage-users');
  assertRecentAuthentication(principal);
  if (principal.id === targetId) throw new Error('Administrators cannot revoke their own access.');

  const db = requireDatabaseClient();
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, role: users.role, isActive: users.isActive, isServiceAccount: users.isServiceAccount })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);
    if (!target || target.isServiceAccount) return null;

    if (target.role === 'admin') {
      const [otherAdmin] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, targetId)))
        .limit(1);
      if (!otherAdmin) throw new Error('The last active administrator cannot be revoked.');
    }

    const now = new Date();
    await tx
      .update(users)
      .set({
        role: 'ura_user',
        isActive: false,
        disabledAt: now,
        ...(target.role !== 'ura_user' ? { roleAssignedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(users.id, targetId));
    const removed = await tx.delete(sessions).where(eq(sessions.userId, targetId)).returning({ id: sessions.id });
    const [assignedWork] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(operationalWorkItems)
      .where(and(eq(operationalWorkItems.assignedTo, targetId), sql`${operationalWorkItems.status} in ('open','assigned','in_progress','blocked')`));

    await tx.insert(auditEvents).values(buildAuditEvent({
      actorId: principal.id,
      action: 'user.emergency-revoke',
      result: 'success',
      entityType: 'user',
      entityId: targetId,
      request,
      metadata: {
        previousRole: target.role,
        previousActive: target.isActive,
        sessionsRevoked: removed.length,
        assignedWorkItems: assignedWork?.count ?? 0,
      },
    }));

    return {
      userId: targetId,
      previousRole: target.role,
      sessionsRevoked: removed.length,
      assignedWorkItems: assignedWork?.count ?? 0,
    };
  });
}
