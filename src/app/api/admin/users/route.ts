import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';
import { createUserByAdministrator, createUserSchema } from '@/server/user-administration';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'admin:manage-users');
    await enforceDatabaseRateLimit(principal.id, 'admin-create-user', { max: 10, windowSeconds: 60 * 15 });
    const input = createUserSchema.parse(await readJsonBody(request));
    const user = await createUserByAdministrator(principal, input, request);
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof ZodError) {
      return Response.json({ error: error.issues[0]?.message ?? 'Request validation failed.' }, { status: 400 });
    }
    return Response.json({ error: 'The account could not be created.' }, { status: 400 });
  }
}
