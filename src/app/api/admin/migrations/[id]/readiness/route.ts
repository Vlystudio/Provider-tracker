import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { getMigrationRun, migrationServiceErrorResponse } from '@/server/migration-service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireRequestPermission(request.headers, 'migration:read');
    const details = await getMigrationRun((await context.params).id);
    return Response.json({ runId: (details.run as { id: string }).id, readiness: (details.run as { readiness: string }).readiness, reconciliation: details.reconciliation, diagnostics: details.diagnostics });
  } catch (error) {
    return authorizationErrorResponse(error) ?? migrationServiceErrorResponse(error)
      ?? Response.json({ error: 'Migration readiness could not be loaded.' }, { status: 500 });
  }
}
