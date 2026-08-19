import 'server-only';

import { and, eq, ne, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { accounts, auditEvents, sessions, users } from '@/db/schema';
import { userRoles } from '@/lib/access-control';
import { assertPermission, type Principal } from './authorization';
import { buildAuditEvent } from './audit';
import { createTrustedProvisioningAuth } from './auth';
import { requireDatabaseClient } from './database';

export const passwordSchema = z
  .string()
  .min(14)
  .max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter.')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
  .regex(/[0-9]/, 'Password must contain a number.')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol.');

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

    const [updated] = await tx
      .update(users)
      .set({ ...input, updatedAt: new Date() })
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
