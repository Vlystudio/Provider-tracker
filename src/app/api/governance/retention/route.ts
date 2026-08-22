import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { saveRetentionPolicy } from '@/server/governance-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function PATCH(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'governance:manage');
    await enforceDatabaseRateLimit(principal.id, 'retention-policy-update', { max: 20, windowSeconds: 60 * 15 });
    const policy = await saveRetentionPolicy(principal, await readJsonBody(request), request);
    return Response.json({ policy });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? 'The retention policy is invalid.' }, { status: 400 });
    return Response.json({ error: 'The retention policy could not be saved.' }, { status: 500 });
  }
}
