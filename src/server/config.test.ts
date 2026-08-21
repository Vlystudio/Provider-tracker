import { describe, expect, it } from 'vitest';
import { assertProductionConfiguration, resolveSecurityConfig, resolveServerConfig } from './config';

const productionSecurity = {
  APP_ENV: 'production' as const,
  DATABASE_URL: 'postgresql://app:secret@database.example/provider_tracker',
  BETTER_AUTH_SECRET: 'a-real-production-secret-with-more-than-32-characters',
  BETTER_AUTH_URL: 'https://provider.example.org',
  AUTH_TRUSTED_ORIGINS: ['https://provider.example.org'],
  AUDIT_LOG_IP_SALT: 'a-separate-production-salt-with-more-than-32-characters',
  NETWORK_ACCESS_MODE: 'private-vpn' as const,
};

describe('server configuration', () => {
  it('does not fall back to sample data when the production database is missing', () => {
    const config = resolveServerConfig({
      APP_ENV: 'production',
      APP_DATA_MODE: 'database',
      DATABASE_URL: undefined,
    });

    expect(config.APP_DATA_MODE).toBe('database');
    expect(config.DATABASE_URL).toBeUndefined();
  });

  it('does not allow sample data in production', () => {
    expect(() =>
      resolveServerConfig({ APP_ENV: 'production', APP_DATA_MODE: 'demo' }),
    ).toThrow('Demo data mode is disabled in production.');
  });

  it('accepts a PostgreSQL connection string', () => {
    const config = resolveServerConfig({
      APP_ENV: 'production',
      APP_DATA_MODE: 'database',
      DATABASE_URL: 'postgresql://app:secret@database.example/provider_tracker',
    });

    expect(config.APP_ENV).toBe('production');
    expect(config.DATABASE_URL).toContain('provider_tracker');
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() =>
      resolveServerConfig({
        APP_ENV: 'development',
        APP_DATA_MODE: 'database',
        DATABASE_URL: 'https://example.com/database',
      }),
    ).toThrow('DATABASE_URL must use a PostgreSQL connection string.');
  });

  it('rejects an unsafe database pool size', () => {
    expect(() =>
      resolveServerConfig({
        APP_ENV: 'development',
        APP_DATA_MODE: 'database',
        DATABASE_POOL_SIZE: 500,
      }),
    ).toThrow();
  });

  it('rejects debug logging in production', () => {
    expect(() => resolveServerConfig({
      APP_ENV: 'production',
      APP_DATA_MODE: 'database',
      LOG_LEVEL: 'debug',
    })).toThrow('Debug logging is disabled in production.');
  });

  it('requires a strong operations token when metrics are enabled', () => {
    expect(() => resolveServerConfig({ OPERATIONS_TOKEN: 'too-short' })).toThrow('OPERATIONS_TOKEN');
    expect(resolveServerConfig({ OPERATIONS_TOKEN: 'a-strong-monitoring-token-value-over-32-characters' }).OPERATIONS_TOKEN).toBeDefined();
  });

  it('accepts a complete production security configuration', () => {
    const config = resolveSecurityConfig(productionSecurity);
    expect(config.BETTER_AUTH_URL).toBe('https://provider.example.org');
  });

  it('fails closed when a production secret is absent', () => {
    expect(() => resolveSecurityConfig({ ...productionSecurity, BETTER_AUTH_SECRET: undefined })).toThrow(
      'BETTER_AUTH_SECRET',
    );
  });

  it('rejects placeholder production secrets', () => {
    expect(() =>
      resolveSecurityConfig({ ...productionSecurity, BETTER_AUTH_SECRET: 'change-this-placeholder-secret-value-now' }),
    ).toThrow('placeholder secrets');
  });

  it('requires HTTPS for the production auth origin', () => {
    expect(() =>
      resolveSecurityConfig({
        ...productionSecurity,
        BETTER_AUTH_URL: 'http://provider.example.org',
        AUTH_TRUSTED_ORIGINS: ['http://provider.example.org'],
      }),
    ).toThrow('HTTPS');
  });

  it('requires an explicit private-network deployment mode in production', () => {
    expect(() => resolveSecurityConfig({ ...productionSecurity, NETWORK_ACCESS_MODE: 'local' })).toThrow(
      'NETWORK_ACCESS_MODE=private-vpn',
    );
  });

  it('accepts a trusted client address only from configured proxy networks', () => {
    expect(() => resolveSecurityConfig({
      ...productionSecurity,
      AUTH_CLIENT_IP_HEADER: 'x-real-ip',
      PROXY_TRUST_MODE: 'off',
      AUTH_TRUSTED_PROXY_CIDRS: [],
    })).toThrow('sanitized ingress');

    expect(resolveSecurityConfig({
      ...productionSecurity,
      AUTH_CLIENT_IP_HEADER: 'x-real-ip',
      PROXY_TRUST_MODE: 'sanitized-ingress',
      AUTH_TRUSTED_PROXY_CIDRS: ['10.20.0.0/16'],
    }).AUTH_TRUSTED_PROXY_CIDRS).toEqual(['10.20.0.0/16']);
  });

  it('rejects inconsistent session timing limits', () => {
    expect(() => resolveSecurityConfig({
      ...productionSecurity,
      AUTH_SESSION_IDLE_SECONDS: 600,
      AUTH_SESSION_TOUCH_SECONDS: 600,
    })).toThrow('touch interval');
  });

  it('requires the configured auth origin in the allowlist', () => {
    expect(() =>
      resolveSecurityConfig({ ...productionSecurity, AUTH_TRUSTED_ORIGINS: ['https://other.example.org'] }),
    ).toThrow('must include BETTER_AUTH_URL');
  });

  it('does not allow a test environment on the production server', () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = 'test';
    try {
      expect(() => assertProductionConfiguration(true)).toThrow('APP_ENV must be set to production');
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }
  });
});
