import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from './authorization';

const databaseMocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('./database', () => ({ getDatabasePool: () => ({ query: databaseMocks.query }) }));
vi.mock('./audit', () => ({ recordAuditEventBestEffort: vi.fn() }));

import { searchProviders } from './provider-search-service';

const principal: Principal = {
  id: '00000000-0000-4000-8000-000000000099',
  name: 'Test user',
  email: 'test@example.invalid',
  role: 'ura_user',
  isActive: true,
  sessionId: 'session',
  sessionCreatedAt: new Date(),
  sessionUpdatedAt: new Date(),
  sessionExpiresAt: new Date(Date.now() + 60_000),
};

describe('provider availability search query', () => {
  beforeEach(() => databaseMocks.query.mockReset());

  it('applies the default long-term-unavailability filter before paging', async () => {
    databaseMocks.query
      .mockResolvedValueOnce({ rows: [{ found: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await searchProviders(principal, { memberZip: '04103' }, { audit: false });

    const query = String(databaseMocks.query.mock.calls[1]?.[0]);
    const parameters = databaseMocks.query.mock.calls[1]?.[1] as unknown[];
    expect(query).toContain("$14::text = 'available_or_review'");
    expect(query).toContain('availability_review_due_at <= now()');
    expect(query.indexOf('filtered AS')).toBeLessThan(query.indexOf('LIMIT $15 OFFSET $16'));
    expect(parameters[13]).toBe('available_or_review');
  });
});
