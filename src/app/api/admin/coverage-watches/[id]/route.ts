import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { operationalServiceErrorResponse, updateCoverageWatch } from '@/server/operational-service';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'coverage:manage');
    return Response.json(await updateCoverageWatch(principal, (await context.params).id, await readJsonBody(request), request));
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? operationalServiceErrorResponse(error) ?? (error instanceof ZodError
      ? Response.json({ error: error.issues[0]?.message ?? 'Invalid coverage watch.' }, { status: 400 })
      : Response.json({ error: 'Coverage watch could not be updated.' }, { status: 500 }));
  }
}
