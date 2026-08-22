import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { placeRetentionHold } from '@/server/governance-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'governance:manage');
    await enforceDatabaseRateLimit(principal.id, 'retention-hold-place', { max: 20, windowSeconds: 60 * 15 });
    const hold = await placeRetentionHold(principal, await readJsonBody(request), request);
    return Response.json({ hold }, { status: 201 });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? 'The hold request is invalid.' }, { status: 400 });
    return Response.json({ error: 'The hold could not be placed.' }, { status: 500 });
  }
}
