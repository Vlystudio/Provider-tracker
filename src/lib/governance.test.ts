import { describe, expect, it } from 'vitest';
import {
  canExportProviderDirectory,
  csvCell,
  currentReviewPeriod,
  isDormantAccount,
  safeFilterKeys,
} from './governance';

describe('governance policy helpers', () => {
  it('flags active accounts after the configured inactivity period without disabling them', () => {
    const now = new Date('2026-08-22T12:00:00Z');
    expect(isDormantAccount({ active: true, lastSignedInAt: '2026-05-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' }, 90, now)).toBe(true);
    expect(isDormantAccount({ active: false, lastSignedInAt: '2026-05-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' }, 90, now)).toBe(false);
  });

  it('uses calendar quarters for access review periods', () => {
    expect(currentReviewPeriod(new Date('2026-08-22T12:00:00Z'))).toBe('2026-Q3');
  });

  it('keeps row export limited to operational roles', () => {
    expect(canExportProviderDirectory('admin')).toBe(true);
    expect(canExportProviderDirectory('ura_user')).toBe(true);
    expect(canExportProviderDirectory('report_viewer')).toBe(false);
    expect(canExportProviderDirectory('auditor')).toBe(false);
  });

  it('neutralizes spreadsheet formulas and reports filter names without values', () => {
    expect(csvCell('=2+2')).toBe('"\'=2+2"');
    expect(csvCell('@SUM(A1:A2)')).toBe('"\'@SUM(A1:A2)"');
    expect(safeFilterKeys({ memberZip: '04530', diagnosis: '', page: 1 })).toEqual(['memberZip', 'page']);
  });
});
