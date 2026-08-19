import { describe, expect, it } from 'vitest';
import { assertProductionConfiguration, resolveSecurityConfig, resolveServerConfig } from './config';

const productionSecurity = {
  APP_ENV: 'production' as const,
  DATABASE_URL: 'postgresql://app:secret@database.example/provider_tracker',
  BETTER_AUTH_SECRET: 'a-real-production-secret-with-more-than-32-characters',
  BETTER_AUTH_URL: 'https://provider.example.org',
  AUTH_TRUSTED_ORIGINS: ['https://provider.example.org'],
  AUDIT_LOG_IP_SALT: 'a-separate-production-salt-with-more-than-32-characters',
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
