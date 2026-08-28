import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import {
  callEntryInputSchema,
  callServiceErrorResponse,
  createCallRecord,
} from '@/server/call-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'operations:write');
    await enforceDatabaseRateLimit(principal.id, 'call-create', { max: 60, windowSeconds: 60 });
    const input = callEntryInputSchema.parse(await readJsonBody(request));
    const call = await createCallRecord(principal, input, request);
    return Response.json({ call }, { status: call.duplicate ? 200 : 201 });
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error) ??
      callServiceErrorResponse(error) ?? (error instanceof ZodError
        ? Response.json({ error: error.issues[0]?.message ?? 'Request validation failed.' }, { status: 400 })
        : Response.json({ error: 'The call could not be saved.' }, { status: 500 }));
  }
}
