import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { diagnosticResolutionSchema, migrationServiceErrorResponse, resolveMigrationDiagnostic } from '@/server/migration-service';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

type RouteContext = { params: Promise<{ id: string; diagnosticId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'migration:review');
    await enforceDatabaseRateLimit(principal.id, 'migration-diagnostic', { max: 60, windowSeconds: 60 });
    const input = diagnosticResolutionSchema.parse(await readJsonBody(request));
    const params = await context.params;
    return Response.json({ diagnostic: await resolveMigrationDiagnostic(principal, params.id, params.diagnosticId, input, request) });
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error)
      ?? rateLimitErrorResponse(error) ?? migrationServiceErrorResponse(error)
      ?? (error instanceof ZodError
        ? Response.json({ error: error.issues[0]?.message ?? 'Resolution is invalid.' }, { status: 400 })
        : Response.json({ error: 'The diagnostic could not be updated.' }, { status: 500 }));
  }
}
