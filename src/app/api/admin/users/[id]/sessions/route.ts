import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, requestSecurityErrorResponse } from '@/server/request-security';
import {
  listUserSessionsForAdministrator,
  revokeAllUserSessionsByAdministrator,
} from '@/server/user-administration';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await requireRequestPermission(request.headers, 'admin:manage-users');
    const sessions = await listUserSessionsForAdministrator(principal, (await context.params).id);
    return Response.json({ sessions });
  } catch (error) {
    return authorizationErrorResponse(error)
      ?? Response.json({ error: 'Sessions could not be loaded.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'admin:manage-users');
    await enforceDatabaseRateLimit(principal.id, 'admin-revoke-user-sessions', { max: 20, windowSeconds: 60 });
    const count = await revokeAllUserSessionsByAdministrator(principal, (await context.params).id, request);
    return Response.json({ revoked: count });
  } catch (error) {
    return authorizationErrorResponse(error)
      ?? requestSecurityErrorResponse(error)
      ?? rateLimitErrorResponse(error)
      ?? Response.json({ error: 'Sessions could not be revoked.' }, { status: 500 });
  }
}
