import { z, ZodError } from 'zod';
import { recordAuditEventBestEffort } from '@/server/audit';
import { getAuth } from '@/server/auth';
import { authorizationErrorResponse, requirePrincipal } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';
import { passwordSchema } from '@/server/user-administration';

const inputSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
}).strict().refine((value) => value.currentPassword !== value.newPassword, {
  path: ['newPassword'],
  message: 'Choose a different password.',
});

export async function POST(request: Request) {
  let actorId: string | null = null;
  try {
    enforceSameOrigin(request);
    const principal = await requirePrincipal(request.headers);
    actorId = principal.id;
    await enforceDatabaseRateLimit(principal.id, 'account-password-change', { max: 5, windowSeconds: 60 * 15 });
    const input = inputSchema.parse(await readJsonBody(request));
    await getAuth().api.changePassword({
      headers: request.headers,
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
    });
    await recordAuditEventBestEffort({
      actorId: principal.id,
      action: 'account.password-change',
      result: 'success',
      entityType: 'user',
      entityId: principal.id,
      request,
    });
    return Response.json({ changed: true });
  } catch (error) {
    if (actorId) {
      await recordAuditEventBestEffort({
        actorId,
        action: 'account.password-change',
        result: 'failure',
        entityType: 'user',
        entityId: actorId,
        request,
      });
    }
    return authorizationErrorResponse(error)
      ?? requestSecurityErrorResponse(error)
      ?? rateLimitErrorResponse(error)
      ?? (error instanceof ZodError
        ? Response.json({ error: error.issues[0]?.message ?? 'Check the password fields.' }, { status: 400 })
        : Response.json({ error: 'The password was not changed. Check the current password and try again.' }, { status: 400 }));
  }
}
