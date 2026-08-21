import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import {
  bulkAssignmentInputSchema,
  bulkAssignReverification,
  providerServiceErrorResponse,
} from '@/server/provider-intelligence-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'admin:manage-data');
    await enforceDatabaseRateLimit(principal.id, 'reverification-bulk-assign', { max: 10, windowSeconds: 60 });
    const input = bulkAssignmentInputSchema.parse(await readJsonBody(request));
    return Response.json(await bulkAssignReverification(principal, input, request));
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error) ??
      providerServiceErrorResponse(error) ?? (error instanceof ZodError
        ? Response.json({ error: error.issues[0]?.message ?? 'Request validation failed.' }, { status: 400 })
        : Response.json({ error: 'Request failed.' }, { status: 500 }));
  }
}

