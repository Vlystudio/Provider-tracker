import { NextResponse, type NextRequest } from 'next/server';
import { can, permissionForPage } from '@/lib/access-control';
import { getPrincipal } from '@/server/authorization';

export async function proxy(request: NextRequest) {
  const permission = permissionForPage(request.nextUrl.pathname);
  if (!permission) return NextResponse.next();

  const principal = await getPrincipal(request.headers);
  if (!principal) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('reason', 'required');
    return NextResponse.redirect(signInUrl);
  }
  if (!can(principal.role, permission)) {
    return NextResponse.redirect(new URL('/forbidden', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/admin/:path*',
    '/audit/:path*',
    '/authorization-summary/:path*',
    '/call-log/:path*',
    '/facilities/:path*',
    '/new-call/:path*',
    '/provider-search/:path*',
    '/reports/:path*',
    '/review-queue/:path*',
  ],
};
