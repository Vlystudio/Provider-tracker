import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import {
  enforceMigrationUploadSize,
  listMigrationRuns,
  migrationServiceErrorResponse,
  previewMigration,
  readMigrationFormData,
  workbooksFromFormData,
} from '@/server/migration-service';
import { enforceSameOrigin, requestSecurityErrorResponse } from '@/server/request-security';

export async function GET(request: Request) {
  try {
    await requireRequestPermission(request.headers, 'migration:read');
    return Response.json({ runs: await listMigrationRuns() });
  } catch (error) {
    return authorizationErrorResponse(error) ?? migrationServiceErrorResponse(error)
      ?? Response.json({ error: 'Migration history could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    enforceMigrationUploadSize(request);
    const principal = await requireRequestPermission(request.headers, 'migration:preview');
    await enforceDatabaseRateLimit(principal.id, 'migration-preview', { max: 5, windowSeconds: 300 });
    const result = await previewMigration(principal, workbooksFromFormData(await readMigrationFormData(request)), request);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error)
      ?? rateLimitErrorResponse(error) ?? migrationServiceErrorResponse(error)
      ?? Response.json({ error: 'The migration preview failed. Check the workbook and try again.' }, { status: 500 });
  }
}
