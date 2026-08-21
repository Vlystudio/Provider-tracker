import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/server/auth';
import { getPrincipal } from '@/server/authorization';
import { hashAuditValue, recordAuditEventBestEffort } from '@/server/audit';
import { incrementMetric } from '@/server/metrics';
import { requestIdFromHeaders, resolveRequestId } from '@/server/request-context';
import { getDatabasePool } from '@/server/database';

const allowedGetPaths = new Set(['/api/auth/get-session']);
const allowedPostPaths = new Set(['/api/auth/sign-in/email', '/api/auth/sign-out']);

export function GET(request: Request) {
  return allowedGetPaths.has(new URL(request.url).pathname)
    ? toNextJsHandler(getAuth()).GET(request)
    : new Response('Not Found', { status: 404 });
}

const auditedActions: Record<string, string> = {
  '/api/auth/sign-in/email': 'auth.sign-in',
  '/api/auth/sign-out': 'auth.sign-out',
};

async function getSafeEmail(request: Request): Promise<string | null> {
  if (!request.url.endsWith('/sign-in/email') && !request.url.endsWith('/forget-password')) return null;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await request.clone().json() as Record<string, unknown>
      : Object.fromEntries(await request.clone().formData());
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    return email || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (!allowedPostPaths.has(pathname)) return new Response('Not Found', { status: 404 });
  const action = auditedActions[pathname];
  if (!action) return new Response('Not Found', { status: 404 });

  const requestId = requestIdFromHeaders(request.headers) ?? resolveRequestId(undefined);
  const principalBefore = action === 'auth.sign-out' ? await getPrincipal(request.headers) : null;
  const signInEmail = await getSafeEmail(request);
  const emailHash = signInEmail ? hashAuditValue(signInEmail) : null;
  const response = await toNextJsHandler(getAuth()).POST(request);

  let actorId = principalBefore?.id ?? null;
  if (response.ok && action === 'auth.sign-in') {
    try {
      const body = await response.clone().json() as { user?: { id?: string } };
      actorId = body.user?.id ?? null;
    } catch {
      actorId = null;
    }
    if (!actorId && signInEmail) {
      const user = await getDatabasePool()?.query<{ id: string }>('SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1', [signInEmail]);
      actorId = user?.rows[0]?.id ?? null;
    }
  }

  await recordAuditEventBestEffort({
    actorId,
    action,
    result: response.ok ? 'success' : 'failure',
    entityType: 'session',
    entityId: actorId,
    request,
    requestId,
    metadata: {
      status: response.status,
      ...(emailHash ? { emailHash } : {}),
    },
  });

  incrementMetric('provider_tracker_authentication_total', {
    operation: action === 'auth.sign-in' ? 'sign_in' : 'sign_out',
    result: response.ok ? 'success' : 'failure',
  });

  return response;
}
