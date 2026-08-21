import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { getNotificationPreferences, saveNotificationPreferences } from '@/server/notification-service';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function GET(request: Request) {
  try {
    return Response.json(await getNotificationPreferences(await requireRequestPermission(request.headers, 'notifications:read')));
  } catch (error) {
    return authorizationErrorResponse(error) ?? Response.json({ error: 'Notification preferences could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'notifications:read');
    return Response.json(await saveNotificationPreferences(principal, await readJsonBody(request), request));
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? (error instanceof ZodError
      ? Response.json({ error: error.issues[0]?.message ?? 'Invalid preferences.' }, { status: 400 })
      : Response.json({ error: 'Notification preferences could not be updated.' }, { status: 500 }));
  }
}
