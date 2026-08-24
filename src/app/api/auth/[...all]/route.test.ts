import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authPost, recordAuditEventBestEffort } = vi.hoisted(() => ({
  authPost: vi.fn(),
  recordAuditEventBestEffort: vi.fn(),
}));

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({ POST: authPost }),
}));
vi.mock('@/server/auth', () => ({ getAuth: () => ({}) }));
vi.mock('@/server/authorization', () => ({ getPrincipal: vi.fn() }));
vi.mock('@/server/audit', () => ({
  hashAuditValue: () => 'email-hash',
  recordAuditEventBestEffort,
}));
vi.mock('@/server/metrics', () => ({ incrementMetric: vi.fn() }));
vi.mock('@/server/request-context', () => ({
  requestIdFromHeaders: () => 'request-id',
  resolveRequestId: () => 'request-id',
}));
vi.mock('@/server/database', () => ({ getDatabasePool: () => undefined }));
vi.mock('@/server/config', () => ({
  getSecurityConfig: () => ({ BETTER_AUTH_URL: 'https://presentation.example' }),
}));

import { POST } from './route';

describe('email sign-in route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authPost.mockResolvedValue(new Response(JSON.stringify({ user: { id: 'user-id' } }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'provider-tracker.session=token; Path=/; HttpOnly; Secure; SameSite=Lax',
      },
    }));
  });

  it('redirects a browser form submission and preserves the session cookie', async () => {
    const request = new Request('https://presentation.example/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-mode': 'navigate',
      },
      body: new URLSearchParams({ email: 'manager@example.invalid', password: 'not-recorded' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://presentation.example/');
    expect(response.headers.get('set-cookie')).toContain('provider-tracker.session=token');
    expect(await response.text()).toBe('');
    expect(recordAuditEventBestEffort).toHaveBeenCalledOnce();
  });

  it('keeps the JSON response for the client-side sign-in request', async () => {
    const request = new Request('https://presentation.example/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'manager@example.invalid', password: 'not-recorded' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: 'user-id' } });
  });
});
