import { describe, expect, it } from 'vitest';
import { resolveHousekeepingExecutionPolicy, retentionCutoff } from './housekeeping';

describe('housekeeping policy', () => {
  it('bounds deletion batches without inventing retention periods', () => {
    expect(resolveHousekeepingExecutionPolicy({})).toEqual({ batchSize: 1_000 });
    expect(retentionCutoff(new Date('2026-08-21T12:00:00Z'), 7).toISOString()).toBe('2026-08-14T12:00:00.000Z');
  });

  it('rejects an unbounded cleanup batch', () => {
    expect(() => resolveHousekeepingExecutionPolicy({ HOUSEKEEPING_BATCH_SIZE: '1000000' })).toThrow();
  });
});
