import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { listNotifications, markAllNotificationsRead } from '@/server/notification-service';
import { enforceSameOrigin, requestSecurityErrorResponse } from '@/server/request-security';

export async function GET(request: Request) {
  try {
    const principal = await requireRequestPermission(request.headers, 'notifications:read');
    const url = new URL(request.url);
    return Response.json(await listNotifications(principal, {
      unreadOnly: url.searchParams.get('view') === 'unread',
      limit: Number(url.searchParams.get('limit') ?? 30),
    }));
  } catch (error) {
    return authorizationErrorResponse(error) ?? (error instanceof ZodError
      ? Response.json({ error: 'Invalid notification filters.' }, { status: 400 })
      : Response.json({ error: 'Notifications could not be loaded.' }, { status: 500 }));
  }
}

export async function PATCH(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'notifications:read');
    return Response.json(await markAllNotificationsRead(principal));
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? Response.json({ error: 'Notifications could not be updated.' }, { status: 500 });
  }
}
