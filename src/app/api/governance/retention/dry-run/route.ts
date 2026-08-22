import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { retentionDryRun } from '@/server/governance-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'governance:manage');
    await enforceDatabaseRateLimit(principal.id, 'retention-dry-run', { max: 30, windowSeconds: 60 * 15 });
    return Response.json({ result: await retentionDryRun(principal, await readJsonBody(request), request) });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? 'The retention dry run is invalid.' }, { status: 400 });
    return Response.json({ error: 'The retention dry run could not be completed.' }, { status: 500 });
  }
}
