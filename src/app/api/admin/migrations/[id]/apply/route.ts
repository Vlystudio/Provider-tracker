import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import {
  applyMigration,
  applyMigrationSchema,
  enforceMigrationUploadSize,
  migrationServiceErrorResponse,
  readMigrationFormData,
  workbooksFromFormData,
} from '@/server/migration-service';
import { enforceSameOrigin, requestSecurityErrorResponse } from '@/server/request-security';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    enforceSameOrigin(request);
    enforceMigrationUploadSize(request);
    const principal = await requireRequestPermission(request.headers, 'migration:apply');
    await enforceDatabaseRateLimit(principal.id, 'migration-apply', { max: 2, windowSeconds: 300 });
    const form = await readMigrationFormData(request);
    const input = applyMigrationSchema.parse({ reason: form.get('reason'), simulateFailureAfterStaging: form.get('simulateFailureAfterStaging') === 'true' });
    return Response.json(await applyMigration(principal, (await context.params).id, workbooksFromFormData(form), input, request));
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error)
      ?? rateLimitErrorResponse(error) ?? migrationServiceErrorResponse(error)
      ?? (error instanceof ZodError
        ? Response.json({ error: error.issues[0]?.message ?? 'Migration approval is invalid.' }, { status: 400 })
        : Response.json({ error: 'The migration could not be applied. The transaction was rolled back.' }, { status: 500 }));
  }
}
