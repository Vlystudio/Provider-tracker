import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { createCoverageWatch } from '@/server/operational-service';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'coverage:manage');
    return Response.json(await createCoverageWatch(principal, await readJsonBody(request), request), { status: 201 });
  } catch (error) {
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? (error instanceof ZodError
      ? Response.json({ error: error.issues[0]?.message ?? 'Invalid coverage watch.' }, { status: 400 })
      : Response.json({ error: 'Coverage watch could not be created.' }, { status: 500 }));
  }
}
