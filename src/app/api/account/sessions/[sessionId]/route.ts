import { authorizationErrorResponse, requirePrincipal } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, requestSecurityErrorResponse } from '@/server/request-security';
import { revokeOwnSession } from '@/server/user-administration';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    enforceSameOrigin(request);
    const principal = await requirePrincipal(request.headers);
    await enforceDatabaseRateLimit(principal.id, 'account-revoke-session', { max: 20, windowSeconds: 60 });
    const revoked = await revokeOwnSession(principal, (await context.params).sessionId, request);
    return revoked
      ? Response.json({ revoked: true })
      : Response.json({ error: 'Session not found.' }, { status: 404 });
  } catch (error) {
    return authorizationErrorResponse(error)
      ?? requestSecurityErrorResponse(error)
      ?? rateLimitErrorResponse(error)
      ?? Response.json({ error: 'The session could not be revoked.' }, { status: 500 });
  }
}
