import { describe, expect, it } from 'vitest';
import { classifyError, redactForLog } from './logger';

describe('structured logging safeguards', () => {
  it('redacts credentials and sensitive fields recursively', () => {
    const redacted = redactForLog({
      password: 'do-not-log',
      nested: {
        authorization: 'Bearer token-value',
        databaseUrl: 'postgresql://user:password@database.example/tracker',
        notes: 'private caller notes',
      },
      message: 'failed against postgresql://user:password@database.example/tracker',
    });

    expect(JSON.stringify(redacted)).not.toContain('do-not-log');
    expect(JSON.stringify(redacted)).not.toContain('token-value');
    expect(JSON.stringify(redacted)).not.toContain('private caller notes');
    expect(JSON.stringify(redacted)).not.toContain('user:password');
    expect(redacted).toMatchObject({ password: '[REDACTED]' });
  });

  it('uses stable operational error categories', () => {
    expect(classifyError({ status: 401 })).toBe('authentication');
    expect(classifyError({ status: 403 })).toBe('authorization');
    expect(classifyError({ status: 429 })).toBe('rate_limit');
    expect(classifyError({ code: '23505' })).toBe('database');
    expect(classifyError(new Error('failed'))).toBe('application');
  });
});
