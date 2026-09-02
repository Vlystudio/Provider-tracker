import { ZodError } from 'zod';
import {
  authorizationErrorResponse,
  requireRequestPermission,
  requirePrincipal,
} from '@/server/authorization';
import {
  authorizationIdSchema,
  authorizationPatchSchema,
  deleteAuthorizationForPrincipal,
  getAuthorizationForPrincipal,
  updateAuthorizationForPrincipal,
} from '@/server/authorization-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import {
  enforceSameOrigin,
  readJsonBody,
  requestSecurityErrorResponse,
} from '@/server/request-security';

function invalidInput(error: ZodError) {
  return Response.json({ error: error.issues[0]?.message ?? 'Request validation failed.' }, { status: 400 });
}

type AuthorizationRouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: AuthorizationRouteContext) {
  try {
    const principal = await requireRequestPermission(request.headers, 'operations:read');
    const id = authorizationIdSchema.parse((await context.params).id);
    const record = await getAuthorizationForPrincipal(principal, id);
    return record
      ? Response.json({ authorization: record })
      : Response.json({ error: 'Tracking record was not found.' }, { status: 404 });
  } catch (error) {
    return authorizationErrorResponse(error) ??
      (error instanceof ZodError ? invalidInput(error) : Response.json({ error: 'Request failed.' }, { status: 500 }));
  }
}

export async function PATCH(request: Request, context: AuthorizationRouteContext) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'operations:write');
    await enforceDatabaseRateLimit(principal.id, 'authorization-write', { max: 60, windowSeconds: 60 });
    const id = authorizationIdSchema.parse((await context.params).id);
    const patch = authorizationPatchSchema.parse(await readJsonBody(request));
    const record = await updateAuthorizationForPrincipal(principal, id, patch, request);
    return record
      ? Response.json({ authorization: record })
      : Response.json({ error: 'Tracking record was not found.' }, { status: 404 });
  } catch (error) {
    return authorizationErrorResponse(error) ??
      requestSecurityErrorResponse(error) ??
      rateLimitErrorResponse(error) ??
      (error instanceof ZodError ? invalidInput(error) : Response.json({ error: 'Request failed.' }, { status: 500 }));
  }
}

export async function DELETE(request: Request, context: AuthorizationRouteContext) {
  try {
    enforceSameOrigin(request);
    const principal = await requirePrincipal(request.headers);
    await enforceDatabaseRateLimit(principal.id, 'authorization-delete', { max: 10, windowSeconds: 60 });
    const id = authorizationIdSchema.parse((await context.params).id);
    const deleted = await deleteAuthorizationForPrincipal(principal, id, request);
    return deleted
      ? new Response(null, { status: 204 })
      : Response.json({ error: 'Tracking record was not found.' }, { status: 404 });
  } catch (error) {
    return authorizationErrorResponse(error) ??
      requestSecurityErrorResponse(error) ??
      rateLimitErrorResponse(error) ??
      (error instanceof ZodError ? invalidInput(error) : Response.json({ error: 'Request failed.' }, { status: 500 }));
  }
}
