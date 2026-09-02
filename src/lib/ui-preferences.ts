import { z } from 'zod';

export const themeValues = ['light', 'dark'] as const;
export const dashboardModeValues = ['simple', 'detailed'] as const;

export type ThemePreference = (typeof themeValues)[number];
export type DashboardModePreference = (typeof dashboardModeValues)[number];

export const THEME_COOKIE = 'provider_tracker_theme';
export const DASHBOARD_MODE_COOKIE = 'provider_tracker_dashboard';

export const uiPreferencesPatchSchema = z.object({
  theme: z.enum(themeValues).optional(),
  dashboardMode: z.enum(dashboardModeValues).optional(),
}).strict().refine((value) => value.theme !== undefined || value.dashboardMode !== undefined, {
  message: 'Choose at least one preference to update.',
});

export function normalizeTheme(value: string | undefined): ThemePreference {
  return value === 'dark' ? 'dark' : 'light';
}

export function normalizeDashboardMode(value: string | undefined): DashboardModePreference {
  return value === 'detailed' ? 'detailed' : 'simple';
}
