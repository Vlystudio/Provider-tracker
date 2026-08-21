import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';
import {
  facilityPatchSchema,
  getFacilityDetail,
  providerServiceErrorResponse,
  updateFacility,
} from '@/server/provider-intelligence-service';

type FacilityRouteContext = { params: Promise<{ id: string }> };

function invalidInput(error: ZodError) {
  return Response.json({ error: error.issues[0]?.message ?? 'Request validation failed.' }, { status: 400 });
}

export async function GET(request: Request, context: FacilityRouteContext) {
  try {
    const principal = await requireRequestPermission(request.headers, 'operations:read');
    const record = await getFacilityDetail(principal, (await context.params).id);
    return record ? Response.json({ facility: record }) : Response.json({ error: 'Facility was not found.' }, { status: 404 });
  } catch (error) {
    return authorizationErrorResponse(error) ?? providerServiceErrorResponse(error) ??
      (error instanceof ZodError ? invalidInput(error) : Response.json({ error: 'Request failed.' }, { status: 500 }));
  }
}

export async function PATCH(request: Request, context: FacilityRouteContext) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'operations:write');
    await enforceDatabaseRateLimit(principal.id, 'facility-write', { max: 60, windowSeconds: 60 });
    const input = facilityPatchSchema.parse(await readJsonBody(request));
    const facility = await updateFacility(principal, (await context.params).id, input, request);
    return Response.json({ facility });
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error) ??
      providerServiceErrorResponse(error) ?? (error instanceof ZodError ? invalidInput(error) : Response.json({ error: 'Request failed.' }, { status: 500 }));
  }
}

