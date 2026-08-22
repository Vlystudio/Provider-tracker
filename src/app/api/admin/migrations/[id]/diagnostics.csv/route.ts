import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { exportMigrationDiagnostics, migrationServiceErrorResponse } from '@/server/migration-service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await requireRequestPermission(request.headers, 'migration:export');
    const id = (await context.params).id;
    return new Response(await exportMigrationDiagnostics(principal, id, request), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="migration-diagnostics-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'private, no-store, max-age=0',
        'content-security-policy': "sandbox; default-src 'none'",
        'x-content-type-options': 'nosniff',
        'x-data-classification': 'confidential-operational',
      },
    });
  } catch (error) {
    return authorizationErrorResponse(error) ?? migrationServiceErrorResponse(error)
      ?? Response.json({ error: 'Diagnostic export failed.' }, { status: 500 });
  }
}
