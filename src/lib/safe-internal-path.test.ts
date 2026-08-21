import { describe, expect, it } from 'vitest';
import { isSafeInternalPath } from './safe-internal-path';

describe('safe internal paths', () => {
  it('accepts application-relative paths', () => {
    expect(isSafeInternalPath('/facilities/28?tab=history')).toBe(true);
  });

  it.each([
    'https://example.invalid',
    '//example.invalid/path',
    '/\\example.invalid/path',
    '/facilities\nset-cookie: value',
    '',
  ])('rejects unsafe link %s', (value) => {
    expect(isSafeInternalPath(value)).toBe(false);
  });
});
