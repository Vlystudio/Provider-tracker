import 'server-only';

import { cookies } from 'next/headers';
import {
  DASHBOARD_MODE_COOKIE,
  THEME_COOKIE,
  normalizeDashboardMode,
  normalizeTheme,
} from '@/lib/ui-preferences';

export async function getUiPreferences() {
  const cookieStore = await cookies();
  return {
    theme: normalizeTheme(cookieStore.get(THEME_COOKIE)?.value),
    dashboardMode: normalizeDashboardMode(cookieStore.get(DASHBOARD_MODE_COOKIE)?.value),
  };
}
