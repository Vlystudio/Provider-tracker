import { describe, expect, it, vi } from 'vitest';
import { classifyError, logEvent, redactForLog } from './logger';

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

  it('redacts account and operational fields before external error reporting', () => {
    expect(redactForLog({
      email: 'person@example.invalid',
      memberZip: '04101',
      diagnosis: 'sensitive value',
      harmless: 'Contact person@example.invalid for help',
    })).toEqual({
      email: '[REDACTED]',
      memberZip: '[REDACTED]',
      diagnosis: '[REDACTED]',
      harmless: 'Contact [REDACTED_EMAIL] for help',
    });
  });

  it('uses stable operational error categories', () => {
    expect(classifyError({ status: 401 })).toBe('authentication');
    expect(classifyError({ status: 403 })).toBe('authorization');
    expect(classifyError({ status: 429 })).toBe('rate_limit');
    expect(classifyError({ code: '23505' })).toBe('database');
    expect(classifyError(new Error('failed'))).toBe('application');
  });

  it('keeps line-break payloads inside one JSON log record', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      logEvent('info', 'security.test', { message: 'first line\n{"level":"error"}' });
      const output = String(write.mock.calls[0]?.[0]);
      expect(output.split('\n')).toHaveLength(2);
      expect(JSON.parse(output.trim()).message).toBe('first line\n{"level":"error"}');
    } finally {
      write.mockRestore();
    }
  });
});
