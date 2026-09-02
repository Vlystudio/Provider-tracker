import { describe, expect, it } from 'vitest';
import { normalizeDashboardMode, normalizeTheme, uiPreferencesPatchSchema } from './ui-preferences';

describe('UI preferences', () => {
  it('uses privacy-safe defaults for invalid or absent cookie values', () => {
    expect(normalizeTheme(undefined)).toBe('light');
    expect(normalizeTheme('unexpected')).toBe('light');
    expect(normalizeDashboardMode(undefined)).toBe('simple');
  });

  it('accepts supported patches and rejects empty or unknown preferences', () => {
    expect(uiPreferencesPatchSchema.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(uiPreferencesPatchSchema.parse({ dashboardMode: 'detailed' })).toEqual({ dashboardMode: 'detailed' });
    expect(() => uiPreferencesPatchSchema.parse({})).toThrow();
    expect(() => uiPreferencesPatchSchema.parse({ compactMode: true })).toThrow();
  });
});
