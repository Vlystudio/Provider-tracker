import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { operationalServiceErrorResponse, updateOperationalWork } from '@/server/operational-service';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'work:write');
    return Response.json(await updateOperationalWork(principal, (await context.params).id, await readJsonBody(request), request));
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? operationalServiceErrorResponse(error) ?? (error instanceof ZodError
      ? Response.json({ error: error.issues[0]?.message ?? 'Invalid work item update.' }, { status: 400 })
      : Response.json({ error: 'Work item could not be updated.' }, { status: 500 }));
  }
}
