import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { assessOrReverseMigration, migrationServiceErrorResponse, reversalSchema } from '@/server/migration-service';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'migration:reverse');
    const input = reversalSchema.parse(await readJsonBody(request));
    return Response.json(await assessOrReverseMigration(principal, (await context.params).id, input, request));
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error)
      ?? migrationServiceErrorResponse(error) ?? (error instanceof ZodError
        ? Response.json({ error: error.issues[0]?.message ?? 'Reversal request is invalid.' }, { status: 400 })
        : Response.json({ error: 'Reversal assessment failed.' }, { status: 500 }));
  }
}
