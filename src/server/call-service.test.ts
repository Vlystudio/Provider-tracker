import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from './authorization';

const databaseMocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('./database', () => ({
  getDatabasePool: () => ({ query: databaseMocks.query }),
  requireDatabaseClient: vi.fn(),
}));

import { callEntryInputSchema, callLogInputSchema, listCallLog } from './call-service';

const facilityId = '00000000-0000-4000-8000-000000000001';
const principal: Principal = {
  id: '00000000-0000-4000-8000-000000000099',
  name: 'Test administrator',
  email: 'test@example.invalid',
  role: 'admin',
  isActive: true,
  sessionId: 'test-session',
  sessionCreatedAt: new Date('2026-09-02T12:00:00.000Z'),
  sessionUpdatedAt: new Date('2026-09-02T12:00:00.000Z'),
  sessionExpiresAt: new Date('2026-09-02T20:00:00.000Z'),
};

beforeEach(() => {
  databaseMocks.query.mockReset();
});

function validCall() {
  return {
    callAt: new Date().toISOString(),
    facilityId,
    authorizationId: '00000000-0000-4000-8000-000000000002',
    contactOutcome: 'reached',
    acceptingNewPatients: 'yes',
    canTreatDiagnosis: 'yes',
    canScheduleWithinFourWeeks: 'yes',
    specialtyConfirmed: 'yes',
  };
}

describe('call entry validation', () => {
  it('accepts a server-generated authorization record ID and applies safe defaults', () => {
    const parsed = callEntryInputSchema.parse(validCall());
    expect(parsed.authorizationId).toBe('00000000-0000-4000-8000-000000000002');
  });

  it('accepts a controlled failed-contact outcome', () => {
    const parsed = callEntryInputSchema.parse({
      callAt: new Date().toISOString(),
      facilityId,
      contactOutcome: 'voicemail_left',
    });
    expect(parsed.contactOutcome).toBe('voicemail_left');
  });

  it('captures a known booking horizon and rejects contradictory or unreachable timing', () => {
    const parsed = callEntryInputSchema.parse({
      ...validCall(),
      canScheduleWithinFourWeeks: 'unknown',
      estimatedWaitDays: 180,
      nextAvailableDate: '2027-03-01',
    });
    expect(parsed.estimatedWaitDays).toBe(180);
    expect(() => callEntryInputSchema.parse({ ...validCall(), estimatedWaitDays: 90 })).toThrow();
    expect(() => callEntryInputSchema.parse({ ...validCall(), contactOutcome: 'no_answer', estimatedWaitDays: 90 })).toThrow();
  });

  it('rejects future calls, bad identifiers, and unsupported fields', () => {
    expect(() => callEntryInputSchema.parse({ ...validCall(), callAt: new Date(Date.now() + 86_400_000).toISOString() })).toThrow();
    expect(() => callEntryInputSchema.parse({ ...validCall(), facilityId: 'not-an-id' })).toThrow();
    expect(() => callEntryInputSchema.parse({ ...validCall(), callerUserId: facilityId })).toThrow();
    expect(() => callEntryInputSchema.parse({ ...validCall(), referralType: 'External' })).toThrow();
  });
});

describe('call log filters', () => {
  it('supports page-by-page access without a global record ceiling', () => {
    const parsed = callLogInputSchema.parse({ page: 27, pageSize: 100 });

    expect(parsed).toMatchObject({ page: 27, pageSize: 100, sort: 'date_desc' });
  });

  it('rejects invalid date ranges and oversized pages', () => {
    expect(() => callLogInputSchema.parse({ from: '2026-09-02', to: '2026-09-01' })).toThrow();
    expect(() => callLogInputSchema.parse({ pageSize: 101 })).toThrow();
  });

  it('queries the complete filtered dataset and paginates Tracking ID groups instead of applying a 500-call ceiling', async () => {
    databaseMocks.query
      .mockResolvedValueOnce({ rows: [{ total_calls: '725', total_groups: '301' }] })
      .mockResolvedValueOnce({ rows: [{
        id: '00000000-0000-4000-8000-000000000010',
        tracking_group_key: 'tracking:00000000-0000-4000-8000-000000000011',
        authorization_id: '00000000-0000-4000-8000-000000000011',
        facility: 'Test Facility',
        result_code: 'unable_to_contact',
        result_phrase: 'unable to contact - no answer',
        call_at: new Date('2026-08-01T14:00:00.000Z'),
        caller_name: 'Test administrator',
      }] });

    const result = await listCallLog(principal, { page: 27, pageSize: 10 });

    expect(result).toMatchObject({ totalCalls: 725, totalGroups: 301, page: 27, pageSize: 10 });
    expect(result.rows[0]).toMatchObject({
      trackingId: 'PT-00000000-0000-4000-8000-000000000011',
      status: 'Follow-up',
    });
    const rowQuery = String(databaseMocks.query.mock.calls[1]?.[0]);
    expect(rowQuery).toContain('GROUP BY bc.tracking_group_key');
    expect(rowQuery).toContain('LIMIT $5 OFFSET $6');
    expect(rowQuery).not.toMatch(/limit\s+500/i);
    expect(databaseMocks.query.mock.calls[1]?.[1]).toEqual([null, null, null, null, 10, 260]);
  });
});
