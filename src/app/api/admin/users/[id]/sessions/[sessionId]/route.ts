import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, requestSecurityErrorResponse } from '@/server/request-security';
import { revokeUserSessionByAdministrator } from '@/server/user-administration';

type RouteContext = { params: Promise<{ id: string; sessionId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'admin:manage-users');
    await enforceDatabaseRateLimit(principal.id, 'admin-revoke-user-session', { max: 20, windowSeconds: 60 });
    const { id, sessionId } = await context.params;
    const revoked = await revokeUserSessionByAdministrator(principal, id, sessionId, request);
    if (!revoked) return Response.json({ error: 'Session not found.' }, { status: 404 });
    return Response.json({ revoked: true });
  } catch (error) {
    return authorizationErrorResponse(error)
      ?? requestSecurityErrorResponse(error)
      ?? rateLimitErrorResponse(error)
      ?? Response.json({ error: 'The session could not be revoked.' }, { status: 500 });
  }
}
