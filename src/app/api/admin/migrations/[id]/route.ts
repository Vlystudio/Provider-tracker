import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { getMigrationRun, migrationServiceErrorResponse } from '@/server/migration-service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireRequestPermission(request.headers, 'migration:read');
    return Response.json(await getMigrationRun((await context.params).id));
  } catch (error) {
    return authorizationErrorResponse(error) ?? migrationServiceErrorResponse(error)
      ?? Response.json({ error: 'Migration details could not be loaded.' }, { status: 500 });
  }
}
