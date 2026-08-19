import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CsrfError,
  InvalidRequestError,
  PayloadTooLargeError,
  enforceSameOrigin,
  readJsonBody,
} from './request-security';

const originalEnvironment = { ...process.env };

beforeEach(() => {
  process.env.APP_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://app:secret@localhost/provider_tracker';
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret-that-is-long-enough-for-validation';
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  process.env.AUTH_TRUSTED_ORIGINS = 'http://localhost:3000';
  process.env.AUDIT_LOG_IP_SALT = 'test-audit-salt-that-is-long-enough-for-validation';
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('request security', () => {
  it('accepts a same-origin mutation', () => {
    const request = new Request('http://localhost:3000/api/example', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
    });
    expect(() => enforceSameOrigin(request)).not.toThrow();
  });

  it('blocks missing and cross-site origins', () => {
    expect(() => enforceSameOrigin(new Request('http://localhost:3000/api/example'))).toThrow(CsrfError);
    expect(() =>
      enforceSameOrigin(
        new Request('http://localhost:3000/api/example', {
          headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
        }),
      ),
    ).toThrow(CsrfError);
  });

  it('requires JSON for protected mutation bodies', async () => {
    const request = new Request('http://localhost:3000/api/example', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    await expect(readJsonBody(request)).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it('rejects oversized request bodies', async () => {
    const request = new Request('http://localhost:3000/api/example', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(200) }),
    });
    await expect(readJsonBody(request, 64)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});
