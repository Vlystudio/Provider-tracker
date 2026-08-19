import { authorizationErrorResponse, requirePrincipal } from '@/server/authorization';

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal(request.headers);
    return Response.json({
      user: {
        id: principal.id,
        name: principal.name,
        role: principal.role,
      },
      session: {
        expiresAt: principal.sessionExpiresAt,
      },
    });
  } catch (error) {
    return authorizationErrorResponse(error) ?? Response.json({ error: 'Request failed.' }, { status: 500 });
  }
}
