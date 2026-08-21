import { NextResponse, type NextRequest } from 'next/server';
import { can, permissionForPage } from '@/lib/access-control';
import { createContentSecurityPolicy } from '@/lib/security-policy';
import { getPrincipal } from '@/server/authorization';
import { recordAuditEventBestEffort } from '@/server/audit';
import { getSecurityConfig, getServerConfig } from '@/server/config';
import { incrementMetric, observeDuration } from '@/server/metrics';
import { getReleaseIdentifier } from '@/server/release';
import { requestIdHeader, resolveRequestId } from '@/server/request-context';

function routeGroup(pathname: string): string {
  if (pathname.startsWith('/api/auth')) return 'auth';
  if (pathname.startsWith('/api')) return 'api';
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/provider-search')) return 'provider_search';
  if (pathname.startsWith('/reports')) return 'reports';
  return 'page';
}

function withOperationalHeaders(
  response: NextResponse,
  requestId: string,
  contentSecurityPolicy: string,
): NextResponse {
  response.headers.set(requestIdHeader, requestId);
  response.headers.set('x-app-release', getReleaseIdentifier());
  response.headers.set('cache-control', response.headers.get('cache-control') ?? 'private, no-store');
  response.headers.set('content-security-policy', contentSecurityPolicy);
  return response;
}

export async function proxy(request: NextRequest) {
  const started = performance.now();
  const runtimeConfig = getServerConfig();
  const securityConfig = getSecurityConfig();
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const contentSecurityPolicy = createContentSecurityPolicy(
    nonce,
    securityConfig.APP_ENV === 'production',
  );
  const requestId = resolveRequestId(
    request.headers.get(requestIdHeader),
    runtimeConfig.REQUEST_ID_SOURCE === 'trusted-proxy',
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(requestIdHeader, requestId);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', contentSecurityPolicy);
  const group = routeGroup(request.nextUrl.pathname);

  const finish = (response: NextResponse, status = response.status) => {
    incrementMetric('provider_tracker_http_requests_total', {
      route: group,
      method: request.method,
      status: String(status),
    });
    observeDuration('provider_tracker_proxy_duration_ms', performance.now() - started, { route: group });
    return withOperationalHeaders(response, requestId, contentSecurityPolicy);
  };

  if (
    securityConfig.APP_ENV === 'production'
    && request.headers.get('host')?.toLowerCase() !== new URL(securityConfig.BETTER_AUTH_URL).host.toLowerCase()
  ) {
    return finish(NextResponse.json({ error: 'Unknown request host.', requestId }, { status: 421 }));
  }

  const applicationUrl = (path: string) => new URL(path, securityConfig.BETTER_AUTH_URL);

  const maintenanceExempt = ['/maintenance', '/api/health', '/api/ready', '/api/metrics'].includes(request.nextUrl.pathname);
  if (runtimeConfig.APP_MAINTENANCE_MODE === 'on' && !maintenanceExempt) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return finish(NextResponse.json({ error: 'Service temporarily unavailable.', requestId }, { status: 503 }));
    }
    return finish(NextResponse.redirect(applicationUrl('/maintenance'), 307));
  }

  const permission = permissionForPage(request.nextUrl.pathname);
  if (!permission) return finish(NextResponse.next({ request: { headers: requestHeaders } }), 200);

  const principal = await getPrincipal(requestHeaders);
  if (!principal) {
    const signInUrl = applicationUrl('/sign-in');
    signInUrl.searchParams.set('reason', 'required');
    return finish(NextResponse.redirect(signInUrl));
  }
  if (!can(principal.role, permission)) {
    await recordAuditEventBestEffort({
      actorId: principal.id,
      action: 'authorization.denied',
      result: 'blocked',
      entityType: 'permission',
      entityId: permission,
      request,
      requestId,
    });
    return finish(NextResponse.redirect(applicationUrl('/forbidden')));
  }
  return finish(NextResponse.next({ request: { headers: requestHeaders } }), 200);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
