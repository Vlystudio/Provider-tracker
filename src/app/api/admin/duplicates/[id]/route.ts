import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import {
  decideDuplicateCandidate,
  duplicateDecisionInputSchema,
  providerServiceErrorResponse,
} from '@/server/provider-intelligence-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

type DuplicateRouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: DuplicateRouteContext) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'admin:manage-data');
    await enforceDatabaseRateLimit(principal.id, 'duplicate-decision', { max: 30, windowSeconds: 60 });
    const input = duplicateDecisionInputSchema.parse(await readJsonBody(request));
    return Response.json({ candidate: await decideDuplicateCandidate(principal, (await context.params).id, input, request) });
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error) ??
      providerServiceErrorResponse(error) ?? (error instanceof ZodError
        ? Response.json({ error: error.issues[0]?.message ?? 'Request validation failed.' }, { status: 400 })
        : Response.json({ error: 'Request failed.' }, { status: 500 }));
  }
}

