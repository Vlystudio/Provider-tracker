import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';
import {
  createVerificationEvent,
  providerServiceErrorResponse,
  verificationEventInputSchema,
} from '@/server/provider-intelligence-service';

type VerificationRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: VerificationRouteContext) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'operations:write');
    await enforceDatabaseRateLimit(principal.id, 'facility-verification', { max: 60, windowSeconds: 60 });
    const input = verificationEventInputSchema.parse(await readJsonBody(request));
    const result = await createVerificationEvent(principal, (await context.params).id, input, request);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error) ??
      providerServiceErrorResponse(error) ?? (error instanceof ZodError
        ? Response.json({ error: error.issues[0]?.message ?? 'Request validation failed.' }, { status: 400 })
        : Response.json({ error: 'Request failed.' }, { status: 500 }));
  }
}

