import { describe, expect, it } from 'vitest';
import { housekeepingCutoffs, resolveHousekeepingPolicy } from './housekeeping';

describe('housekeeping policy', () => {
  it('uses conservative retention and bounded batches', () => {
    const policy = resolveHousekeepingPolicy({});
    const cutoffs = housekeepingCutoffs(new Date('2026-08-21T12:00:00Z'), policy);
    expect(policy).toEqual({ sessionRetentionDays: 7, verificationTokenRetentionDays: 7, rateLimitRetentionHours: 24, batchSize: 1_000 });
    expect(cutoffs.sessionsBefore.toISOString()).toBe('2026-08-14T12:00:00.000Z');
  });

  it('rejects an unbounded cleanup batch', () => {
    expect(() => resolveHousekeepingPolicy({ HOUSEKEEPING_BATCH_SIZE: '1000000' })).toThrow();
  });
});
