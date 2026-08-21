import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import {
  facilityMergeInputSchema,
  mergeFacilities,
  providerServiceErrorResponse,
} from '@/server/provider-intelligence-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'admin:manage-data');
    await enforceDatabaseRateLimit(principal.id, 'facility-merge', { max: 10, windowSeconds: 60 });
    const input = facilityMergeInputSchema.parse(await readJsonBody(request));
    return Response.json(await mergeFacilities(principal, input, request), { status: 201 });
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error) ??
      providerServiceErrorResponse(error) ?? (error instanceof ZodError
        ? Response.json({ error: error.issues[0]?.message ?? 'Request validation failed.' }, { status: 400 })
        : Response.json({ error: 'Request failed.' }, { status: 500 }));
  }
}

