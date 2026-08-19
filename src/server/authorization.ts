import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { can, isUserRole, type Permission, type UserRole } from '@/lib/access-control';
import { getAuth } from './auth';

export type Principal = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  sessionId: string;
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

export async function getPrincipal(requestHeaders: Headers): Promise<Principal | null> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session || !isUserRole(session.user.role) || session.user.isActive !== true) {
    return null;
  }

  return {
    id: session.user.id,
    name: session.user.displayName || session.user.name,
    email: session.user.email,
    role: session.user.role,
    isActive: session.user.isActive,
    sessionId: session.session.id,
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

export async function requireRequestPermission(
  requestHeaders: Headers,
  permission: Permission,
): Promise<Principal> {
  const principal = await requirePrincipal(requestHeaders);
  assertPermission(principal, permission);
  return principal;
}

export async function requirePagePermission(permission: Permission): Promise<Principal> {
  const principal = await getPrincipal(await headers());
  if (!principal) redirect('/sign-in');
  if (!can(principal.role, permission)) redirect('/forbidden');
  return principal;
}

export function authorizationErrorResponse(error: unknown): Response | null {
  if (error instanceof AuthenticationRequiredError) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }
  if (error instanceof PermissionDeniedError) {
    return Response.json({ error: 'Permission denied.' }, { status: 403 });
  }
  return null;
}
