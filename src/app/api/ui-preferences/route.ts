import { cookies } from 'next/headers';
import { ZodError } from 'zod';
import {
  DASHBOARD_MODE_COOKIE,
  THEME_COOKIE,
  normalizeDashboardMode,
  normalizeTheme,
  uiPreferencesPatchSchema,
} from '@/lib/ui-preferences';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 365,
  path: '/',
};

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const principal = await requireRequestPermission(request.headers, 'app:access');
    await enforceDatabaseRateLimit(principal.id, 'ui-preferences-update', { max: 120, windowSeconds: 60 });
    const input = uiPreferencesPatchSchema.parse(await readJsonBody(request));
    const cookieStore = await cookies();
    if (input.theme) cookieStore.set(THEME_COOKIE, input.theme, cookieOptions);
    if (input.dashboardMode) cookieStore.set(DASHBOARD_MODE_COOKIE, input.dashboardMode, cookieOptions);
    return Response.json({
      theme: normalizeTheme(input.theme ?? cookieStore.get(THEME_COOKIE)?.value),
      dashboardMode: normalizeDashboardMode(input.dashboardMode ?? cookieStore.get(DASHBOARD_MODE_COOKIE)?.value),
    });
  } catch (error) {
    return authorizationErrorResponse(error)
      ?? requestSecurityErrorResponse(error)
      ?? rateLimitErrorResponse(error)
      ?? (error instanceof ZodError
        ? Response.json({ error: error.issues[0]?.message ?? 'Invalid preferences.' }, { status: 400 })
        : Response.json({ error: 'Preferences could not be updated.' }, { status: 500 }));
  }
}
