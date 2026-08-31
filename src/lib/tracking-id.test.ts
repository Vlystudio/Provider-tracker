import { describe, expect, it } from 'vitest';
import { isSensitiveIdentifierHeader } from './import/workbook-parser';
import { formatTrackingId } from './tracking-id';

describe('tracking identifiers', () => {
  it('formats the full random record UUID without truncating uniqueness', () => {
    expect(formatTrackingId('01234567-89ab-4cde-8f01-23456789abcd'))
      .toBe('PT-01234567-89AB-4CDE-8F01-23456789ABCD');
  });

  it('recognizes legacy sensitive identifier columns for discard', () => {
    expect(isSensitiveIdentifierHeader(['auth', 'number'].join(''))).toBe(true);
    expect(isSensitiveIdentifierHeader(['authorization', 'number'].join(''))).toBe(true);
    expect(isSensitiveIdentifierHeader('trackingid')).toBe(false);
  });
});
