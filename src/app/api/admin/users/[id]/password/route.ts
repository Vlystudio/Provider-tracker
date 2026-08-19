import { z, ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';
import { passwordSchema, resetUserPasswordByAdministrator } from '@/server/user-administration';

const idSchema = z.string().uuid();
const bodySchema = z.object({ newPassword: passwordSchema }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'admin:manage-users');
    await enforceDatabaseRateLimit(principal.id, 'admin-reset-password', { max: 5, windowSeconds: 60 * 15 });
    const id = idSchema.parse((await context.params).id);
    const { newPassword } = bodySchema.parse(await readJsonBody(request));
    const updated = await resetUserPasswordByAdministrator(principal, id, newPassword, request);
    return updated
      ? Response.json({ status: 'updated' })
      : Response.json({ error: 'User was not found.' }, { status: 404 });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof ZodError) {
      return Response.json({ error: error.issues[0]?.message ?? 'Request validation failed.' }, { status: 400 });
    }
    return Response.json({ error: 'The password could not be changed.' }, { status: 500 });
  }
}
