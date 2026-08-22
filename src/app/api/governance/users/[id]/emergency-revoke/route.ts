import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, requestSecurityErrorResponse } from '@/server/request-security';
import { emergencyRevokeUserByAdministrator } from '@/server/user-administration';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'governance:manage');
    await enforceDatabaseRateLimit(principal.id, 'emergency-access-revoke', { max: 10, windowSeconds: 60 * 15 });
    const result = await emergencyRevokeUserByAdministrator(principal, (await context.params).id, request);
    return result ? Response.json({ result }) : Response.json({ error: 'The account was not found.' }, { status: 404 });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof Error && /own access|last active administrator/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: 'Emergency access revocation failed.' }, { status: 500 });
  }
}
