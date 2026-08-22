import { ZodError } from 'zod';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { exportProviderDirectory } from '@/server/export-service';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'operations:export');
    await enforceDatabaseRateLimit(principal.id, 'provider-directory-export', { max: 5, windowSeconds: 60 * 15 });
    const exported = await exportProviderDirectory(principal, await readJsonBody(request), request);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(exported.csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="provider-directory-${date}.csv"`,
        'cache-control': 'private, no-store, max-age=0',
        'content-security-policy': "sandbox; default-src 'none'",
        'x-content-type-options': 'nosniff',
        'x-data-classification': 'confidential-operational',
        'x-export-record-count': String(exported.recordCount),
        'x-export-truncated': String(exported.truncated),
      },
    });
  } catch (error) {
    const known = authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error);
    if (known) return known;
    if (error instanceof ZodError) {
      return Response.json({ error: error.issues[0]?.message ?? 'Export filters are invalid.' }, { status: 400 });
    }
    return Response.json({ error: 'The provider export could not be created.' }, { status: 500 });
  }
}
