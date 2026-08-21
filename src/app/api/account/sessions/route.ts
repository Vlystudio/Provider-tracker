import { authorizationErrorResponse, requirePrincipal } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, requestSecurityErrorResponse } from '@/server/request-security';
import { listOwnSessions, revokeOwnOtherSessions } from '@/server/user-administration';

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal(request.headers);
    return Response.json({ sessions: await listOwnSessions(principal) });
  } catch (error) {
    return authorizationErrorResponse(error)
      ?? Response.json({ error: 'Sessions could not be loaded.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requirePrincipal(request.headers);
    await enforceDatabaseRateLimit(principal.id, 'account-revoke-other-sessions', { max: 10, windowSeconds: 60 });
    return Response.json({ revoked: await revokeOwnOtherSessions(principal, request) });
  } catch (error) {
    return authorizationErrorResponse(error)
      ?? requestSecurityErrorResponse(error)
      ?? rateLimitErrorResponse(error)
      ?? Response.json({ error: 'Sessions could not be revoked.' }, { status: 500 });
  }
}
