import { describe, expect, it } from 'vitest';
import nextConfig, { securityHeaders } from '../../next.config';

describe('security headers', () => {
  it('sets the baseline browser protections', () => {
    const headers = new Map(securityHeaders.map(({ key, value }) => [key, value]));

    expect(headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
  });

  it('does not advertise the framework', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
