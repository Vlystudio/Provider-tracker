import { describe, expect, it } from 'vitest';
import { resolveServerConfig } from './config';

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
});
