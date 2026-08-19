import { z, ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';
import { updateUserAccessByAdministrator, updateUserAccessSchema } from '@/server/user-administration';

const idSchema = z.string().uuid();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'admin:manage-users');
    await enforceDatabaseRateLimit(principal.id, 'admin-update-user', { max: 20, windowSeconds: 60 });
    const id = idSchema.parse((await context.params).id);
    const input = updateUserAccessSchema.parse(await readJsonBody(request));
    const user = await updateUserAccessByAdministrator(principal, id, input, request);
    return user
      ? Response.json({ user })
      : Response.json({ error: 'User was not found.' }, { status: 404 });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof ZodError) {
      return Response.json({ error: error.issues[0]?.message ?? 'Request validation failed.' }, { status: 400 });
    }
    if (error instanceof Error && /own role|last active administrator/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: 'The account could not be updated.' }, { status: 500 });
  }
}
