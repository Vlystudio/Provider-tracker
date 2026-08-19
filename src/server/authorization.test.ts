import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./auth', () => ({ getAuth: () => ({ api: { getSession } }) }));

import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  getPrincipal,
  requireRequestPermission,
} from './authorization';

const requestHeaders = new Headers();

function sessionFor(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: '8d5e6eed-f6de-48c8-a3dc-a25da9ad4dc8',
      name: 'Staff User',
      displayName: 'Staff User',
      email: 'staff@example.org',
      role: 'ura_user',
      isActive: true,
      ...overrides,
    },
    session: {
      id: '4639b29b-1b9d-4a54-b48d-1733fd4110e0',
      expiresAt: new Date(Date.now() + 60_000),
    },
  };
}

beforeEach(() => getSession.mockReset());

describe('server authorization', () => {
  it('rejects anonymous requests', async () => {
    getSession.mockResolvedValue(null);
    await expect(requireRequestPermission(requestHeaders, 'app:access')).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
  });

  it('rejects disabled accounts and unrecognized role values', async () => {
    getSession.mockResolvedValue(sessionFor({ isActive: false }));
    await expect(getPrincipal(requestHeaders)).resolves.toBeNull();
    getSession.mockResolvedValue(sessionFor({ role: 'admin-from-browser' }));
    await expect(getPrincipal(requestHeaders)).resolves.toBeNull();
  });

  it('does not allow a normal user to call an admin operation', async () => {
    getSession.mockResolvedValue(sessionFor());
    await expect(requireRequestPermission(requestHeaders, 'admin:manage-users')).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it('allows an administrator to call an approved admin operation', async () => {
    getSession.mockResolvedValue(sessionFor({ role: 'admin' }));
    const principal = await requireRequestPermission(requestHeaders, 'admin:manage-users');
    expect(principal.role).toBe('admin');
  });
});
