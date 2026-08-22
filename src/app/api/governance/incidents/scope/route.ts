import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { investigateAccount } from '@/server/governance-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'security:investigate');
    await enforceDatabaseRateLimit(principal.id, 'security-investigation', { max: 20, windowSeconds: 60 * 15 });
    const report = await investigateAccount(principal, await readJsonBody(request), request);
    return report ? Response.json({ report }) : Response.json({ error: 'The account was not found.' }, { status: 404 });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? 'The investigation request is invalid.' }, { status: 400 });
    return Response.json({ error: 'The investigation report could not be created.' }, { status: 500 });
  }
}
