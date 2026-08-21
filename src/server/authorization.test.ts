import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, deleteWhere, updateWhere, setUpdate } = vi.hoisted(() => ({
  getSession: vi.fn(),
  deleteWhere: vi.fn(),
  updateWhere: vi.fn(),
  setUpdate: vi.fn(),
}));
vi.mock('./auth', () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock('./audit', () => ({ recordAuditEventBestEffort: vi.fn() }));
vi.mock('./config', () => ({
  getSecurityConfig: () => ({
    AUTH_SESSION_IDLE_SECONDS: 1_800,
    AUTH_SESSION_TOUCH_SECONDS: 60,
    PRIVILEGED_AUTH_MAX_AGE_SECONDS: 900,
  }),
}));
vi.mock('./database', () => ({
  requireDatabaseClient: () => ({
    delete: () => ({ where: deleteWhere }),
    update: () => ({ set: setUpdate.mockReturnValue({ where: updateWhere }) }),
  }),
}));

import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  ReauthenticationRequiredError,
  assertRecentAuthentication,
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
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  };
}

beforeEach(() => {
  getSession.mockReset();
  deleteWhere.mockReset();
  updateWhere.mockReset();
  setUpdate.mockClear();
});

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

  it('expires an idle session and removes it from the database', async () => {
    getSession.mockResolvedValue({
      ...sessionFor(),
      session: {
        ...sessionFor().session,
        updatedAt: new Date(Date.now() - 1_801_000),
      },
    });

    await expect(getPrincipal(requestHeaders)).resolves.toBeNull();
    expect(deleteWhere).toHaveBeenCalledOnce();
  });

  it('requires a recent login for privileged actions', () => {
    const principal = {
      id: '8d5e6eed-f6de-48c8-a3dc-a25da9ad4dc8',
      name: 'Administrator',
      email: 'admin@example.org',
      role: 'admin' as const,
      isActive: true,
      sessionId: '4639b29b-1b9d-4a54-b48d-1733fd4110e0',
      sessionCreatedAt: new Date('2026-08-21T12:00:00Z'),
      sessionUpdatedAt: new Date('2026-08-21T12:20:00Z'),
      sessionExpiresAt: new Date('2026-08-21T20:00:00Z'),
    };

    expect(() => assertRecentAuthentication(principal, new Date('2026-08-21T12:14:59Z'))).not.toThrow();
    expect(() => assertRecentAuthentication(principal, new Date('2026-08-21T12:15:01Z')))
      .toThrow(ReauthenticationRequiredError);
  });
});
