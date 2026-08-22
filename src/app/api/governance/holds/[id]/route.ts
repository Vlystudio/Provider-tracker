import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { releaseRetentionHold } from '@/server/governance-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'governance:manage');
    await enforceDatabaseRateLimit(principal.id, 'retention-hold-release', { max: 20, windowSeconds: 60 * 15 });
    const hold = await releaseRetentionHold(principal, (await context.params).id, await readJsonBody(request), request);
    return hold ? Response.json({ hold }) : Response.json({ error: 'The active hold was not found.' }, { status: 404 });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? 'The hold release is invalid.' }, { status: 400 });
    return Response.json({ error: 'The hold could not be released.' }, { status: 500 });
  }
}
