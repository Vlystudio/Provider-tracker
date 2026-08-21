import { describe, expect, it } from 'vitest';
import { nextConfig, securityHeaders } from '../../next.config';
import { createContentSecurityPolicy } from './security-policy';

describe('security headers', () => {
  it('sets the baseline browser protections', () => {
    const headers = new Map(securityHeaders.map(({ key, value }) => [key, value]));

    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
  });

  it('uses a nonce-based production policy without permissive script directives', () => {
    const policy = createContentSecurityPolicy('test_nonce_value_12345', true);

    expect(policy).toContain("script-src 'self' 'nonce-test_nonce_value_12345' 'strict-dynamic'");
    expect(policy).toContain("style-src 'self' 'nonce-test_nonce_value_12345'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('rejects an invalid nonce', () => {
    expect(() => createContentSecurityPolicy("bad'nonce", true)).toThrow('valid CSP nonce');
  });

  it('does not advertise the framework', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
