import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { recordAccessReviewDecision } from '@/server/governance-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'governance:manage');
    await enforceDatabaseRateLimit(principal.id, 'access-review-decision', { max: 60, windowSeconds: 60 * 15 });
    const decision = await recordAccessReviewDecision(principal, await readJsonBody(request), request);
    return decision
      ? Response.json({ decision }, { status: 201 })
      : Response.json({ error: 'The account was not found.' }, { status: 404 });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? 'The review decision is invalid.' }, { status: 400 });
    return Response.json({ error: 'The review decision could not be saved.' }, { status: 500 });
  }
}
