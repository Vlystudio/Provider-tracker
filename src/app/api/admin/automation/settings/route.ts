import { ZodError } from 'zod';
import { getAutomationSettings, saveAutomationSettings } from '@/server/automation-config';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function GET(request: Request) {
  try {
    await requireRequestPermission(request.headers, 'automation:read');
    return Response.json(await getAutomationSettings());
  } catch (error) {
    return authorizationErrorResponse(error) ?? Response.json({ error: 'Automation settings could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'automation:manage');
    return Response.json(await saveAutomationSettings(principal, await readJsonBody(request), request));
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? (error instanceof ZodError
      ? Response.json({ error: error.issues[0]?.message ?? 'Invalid automation settings.' }, { status: 400 })
      : Response.json({ error: 'Automation settings could not be updated.' }, { status: 500 }));
  }
}
