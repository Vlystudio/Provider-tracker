import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from './authorization';

const databaseMocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('./database', () => ({ getDatabasePool: () => ({ query: databaseMocks.query }) }));

import { getDashboardSummary } from './dashboard-service';

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

describe('dashboard summary', () => {
  beforeEach(() => databaseMocks.query.mockReset());

  it('loads all simple and detailed metrics in one aggregate query', async () => {
    databaseMocks.query.mockResolvedValue({ rows: [{
      active_facilities: '20',
      calls_this_week: '7',
      active_work: '3',
      availability_due: '4',
      fresh_accepting: '8',
      confirmed_unavailable: '2',
      unconfirmed_availability: '5',
      important_changes: '1',
    }] });

    const result = await getDashboardSummary(principal);

    expect(result.cards.map((card) => card.value)).toEqual(['7', '3', '4', '8']);
    expect(result.reliability.confirmedUnavailable).toBe(2);
    expect(databaseMocks.query).toHaveBeenCalledTimes(1);
    expect(String(databaseMocks.query.mock.calls[0]?.[0])).toContain("interval '30 days'");
    expect(databaseMocks.query.mock.calls[0]?.[1]).toEqual([false, principal.id]);
  });
});
