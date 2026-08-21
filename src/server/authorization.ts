import 'server-only';

import { and, eq, lte } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { can, isUserRole, type Permission, type UserRole } from '@/lib/access-control';
import { sessions } from '@/db/schema';
import { getAuth } from './auth';
import { recordAuditEventBestEffort } from './audit';
import { getSecurityConfig } from './config';
import { requireDatabaseClient } from './database';

export type Principal = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  sessionId: string;
  sessionCreatedAt: Date;
  sessionUpdatedAt: Date;
  sessionExpiresAt: Date;
};

export class AuthenticationRequiredError extends Error {
  readonly status = 401;
  constructor() {
    super('Authentication required.');
  }
}

export class PermissionDeniedError extends Error {
  readonly status = 403;
  constructor() {
    super('Permission denied.');
  }
}

export class ReauthenticationRequiredError extends Error {
  readonly status = 401;
  constructor() {
    super('Recent authentication required.');
  }
}

export async function getPrincipal(requestHeaders: Headers): Promise<Principal | null> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session || !isUserRole(session.user.role) || session.user.isActive !== true) {
    return null;
  }

  const securityConfig = getSecurityConfig();
  const now = new Date();
  const createdAt = new Date(session.session.createdAt);
  const updatedAt = new Date(session.session.updatedAt);
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(updatedAt.getTime())) return null;

  const idleCutoff = new Date(now.getTime() - securityConfig.AUTH_SESSION_IDLE_SECONDS * 1_000);
  const db = requireDatabaseClient();
  if (updatedAt <= idleCutoff) {
    await db.delete(sessions).where(eq(sessions.id, session.session.id));
    return null;
  }

  const touchCutoff = new Date(now.getTime() - securityConfig.AUTH_SESSION_TOUCH_SECONDS * 1_000);
  if (updatedAt <= touchCutoff) {
    await db
      .update(sessions)
      .set({ updatedAt: now })
      .where(and(eq(sessions.id, session.session.id), lte(sessions.updatedAt, updatedAt)));
  }

  return {
    id: session.user.id,
    name: session.user.displayName || session.user.name,
    email: session.user.email,
    role: session.user.role,
    isActive: session.user.isActive,
    sessionId: session.session.id,
    sessionCreatedAt: createdAt,
    sessionUpdatedAt: updatedAt,
    sessionExpiresAt: session.session.expiresAt,
  };
}

export async function requirePrincipal(requestHeaders: Headers): Promise<Principal> {
  const principal = await getPrincipal(requestHeaders);
  if (!principal) throw new AuthenticationRequiredError();
  return principal;
}

export function assertPermission(principal: Principal, permission: Permission): void {
  if (!can(principal.role, permission)) throw new PermissionDeniedError();
}

export function assertRecentAuthentication(principal: Principal, now = new Date()): void {
  const maximumAge = getSecurityConfig().PRIVILEGED_AUTH_MAX_AGE_SECONDS * 1_000;
  if (now.getTime() - principal.sessionCreatedAt.getTime() > maximumAge) {
    throw new ReauthenticationRequiredError();
  }
}

export async function requireRequestPermission(
  requestHeaders: Headers,
  permission: Permission,
): Promise<Principal> {
  const principal = await requirePrincipal(requestHeaders);
  if (!can(principal.role, permission)) {
    await recordAuditEventBestEffort({
      actorId: principal.id,
      action: 'authorization.denied',
      result: 'blocked',
      entityType: 'permission',
      entityId: permission,
    });
    throw new PermissionDeniedError();
  }
  return principal;
}

export async function requirePagePermission(permission: Permission): Promise<Principal> {
  const principal = await getPrincipal(await headers());
  if (!principal) redirect('/sign-in');
  if (!can(principal.role, permission)) {
    await recordAuditEventBestEffort({
      actorId: principal.id,
      action: 'authorization.denied',
      result: 'blocked',
      entityType: 'permission',
      entityId: permission,
    });
    redirect('/forbidden');
  }
  return principal;
}

export function authorizationErrorResponse(error: unknown): Response | null {
  if (error instanceof AuthenticationRequiredError) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }
  if (error instanceof PermissionDeniedError) {
    return Response.json({ error: 'Permission denied.' }, { status: 403 });
  }
  if (error instanceof ReauthenticationRequiredError) {
    return Response.json(
      { error: 'Sign out and sign in again before completing this action.', code: 'recent_authentication_required' },
      { status: 401 },
    );
  }
  return null;
}
