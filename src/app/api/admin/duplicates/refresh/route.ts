import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { refreshDuplicateCandidates } from '@/server/provider-intelligence-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, requestSecurityErrorResponse } from '@/server/request-security';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'admin:manage-data');
    await enforceDatabaseRateLimit(principal.id, 'duplicate-refresh', { max: 5, windowSeconds: 60 });
    return Response.json(await refreshDuplicateCandidates(principal, request));
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error) ??
      Response.json({ error: 'Request failed.' }, { status: 500 });
  }
}

