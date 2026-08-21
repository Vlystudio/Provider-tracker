import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, humanizeKey } from './format';

describe('display formatting', () => {
  it('keeps date-only values on the intended calendar day', () => {
    expect(formatDate('2026-05-04')).toBe('May 4, 2026');
  });

  it('formats timestamps in Eastern Time', () => {
    const value = formatDateTime('2026-05-04T14:30:00.000Z');

    expect(value).toContain('May 4, 2026');
    expect(value).toContain('10:30 AM');
    expect(value).toContain('EDT');
  });

  it('uses a clear fallback for missing or invalid values', () => {
    expect(formatDate(null)).toBe('Not recorded');
    expect(formatDateTime('not-a-date')).toBe('Not recorded');
  });

  it('turns stored keys into readable labels', () => {
    expect(humanizeKey('authorization.update_failed')).toBe('Authorization Update Failed');
  });
});
