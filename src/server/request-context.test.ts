import { describe, expect, it } from 'vitest';
import { normalizeRequestId, resolveRequestId } from './request-context';

describe('request correlation IDs', () => {
  it('accepts only bounded safe identifiers', () => {
    expect(normalizeRequestId('proxy-01/request-123')).toBe('proxy-01/request-123');
    expect(normalizeRequestId('short')).toBeNull();
    expect(normalizeRequestId('bad value with spaces')).toBeNull();
    expect(normalizeRequestId('x'.repeat(129))).toBeNull();
  });

  it('ignores caller-provided identifiers unless a trusted proxy is configured', () => {
    expect(resolveRequestId('proxy-request-123', true)).toBe('proxy-request-123');
    expect(resolveRequestId('proxy-request-123', false)).not.toBe('proxy-request-123');
  });
});
