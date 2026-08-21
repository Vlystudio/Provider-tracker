import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { markNotificationRead, notificationServiceErrorResponse } from '@/server/notification-service';
import { enforceSameOrigin, requestSecurityErrorResponse } from '@/server/request-security';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'notifications:read');
    return Response.json(await markNotificationRead(principal, (await context.params).id));
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? notificationServiceErrorResponse(error) ?? (error instanceof ZodError
      ? Response.json({ error: 'Notification not found.' }, { status: 404 })
      : Response.json({ error: 'Notification could not be updated.' }, { status: 500 }));
  }
}
