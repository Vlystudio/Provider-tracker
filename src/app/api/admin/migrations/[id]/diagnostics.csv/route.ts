import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { exportMigrationDiagnostics, migrationServiceErrorResponse } from '@/server/migration-service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireRequestPermission(request.headers, 'migration:export');
    const id = (await context.params).id;
    return new Response(await exportMigrationDiagnostics(id), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="migration-${id}-diagnostics.csv"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return authorizationErrorResponse(error) ?? migrationServiceErrorResponse(error)
      ?? Response.json({ error: 'Diagnostic export failed.' }, { status: 500 });
  }
}
