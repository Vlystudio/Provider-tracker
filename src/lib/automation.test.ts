import { describe, expect, it } from 'vitest';
import {
  decideFailedContactWork,
  decideReverificationWork,
  detectMeaningfulChanges,
  evaluateCoverageTransition,
  severityMeetsMinimum,
} from './automation';

describe('automation rules', () => {
  const now = new Date('2026-08-21T12:00:00Z');

  it('creates deterministic stale and never-verified work', () => {
    expect(decideReverificationWork({ lastVerifiedAt: null, now, staleDays: 90, upcomingDays: 7 })?.reasonCodes).toEqual(['never_verified']);
    expect(decideReverificationWork({ lastVerifiedAt: new Date('2026-05-01T12:00:00Z'), now, staleDays: 90, upcomingDays: 7 })?.reasonCodes).toEqual(['stale']);
    expect(decideReverificationWork({ lastVerifiedAt: new Date('2026-08-01T12:00:00Z'), now, staleDays: 90, upcomingDays: 7 })).toBeNull();
  });

  it('uses an explicit availability review date instead of a generic stale interval', () => {
    const futureDueAt = new Date('2026-12-01T12:00:00Z');
    expect(decideReverificationWork({
      lastVerifiedAt: new Date('2026-01-01T12:00:00Z'),
      dueAt: futureDueAt,
      now,
      staleDays: 30,
      upcomingDays: 7,
    })).toBeNull();
    expect(decideReverificationWork({
      lastVerifiedAt: new Date('2026-01-01T12:00:00Z'),
      dueAt: new Date('2026-08-20T12:00:00Z'),
      now,
      staleDays: 30,
      upcomingDays: 7,
    })?.reasonCodes).toEqual(['stale']);
  });

  it('uses contact-specific follow-up rules', () => {
    expect(decideFailedContactWork({ attemptedAt: now, outcome: 'voicemail_left' })?.dueAt.toISOString()).toBe('2026-08-23T12:00:00.000Z');
    expect(decideFailedContactWork({ attemptedAt: now, outcome: 'disconnected' })?.workType).toBe('data_quality');
    expect(decideFailedContactWork({ attemptedAt: now, outcome: 'verified' })).toBeNull();
  });

  it('only emits meaningful availability changes', () => {
    expect(detectMeaningfulChanges({ previous: { estimatedWaitDays: 21 }, resulting: { estimatedWaitDays: 22 }, waitIncreaseDays: 14, waitIncreasePercent: 50 })).toEqual([]);
    expect(detectMeaningfulChanges({ previous: { acceptingStatus: 'yes', estimatedWaitDays: 21 }, resulting: { acceptingStatus: 'no', estimatedWaitDays: 90 }, waitIncreaseDays: 14, waitIncreasePercent: 50 }).map((item) => item.eventType)).toEqual(['stopped_accepting', 'wait_increased']);
  });

  it('opens, holds, resolves, and reopens coverage cycles', () => {
    expect(evaluateCoverageTransition({ state: 'healthy', cycle: 0, observedCount: 1, minimumCount: 2 })).toEqual({ nextState: 'alerting', nextCycle: 1, event: 'opened' });
    expect(evaluateCoverageTransition({ state: 'alerting', cycle: 1, observedCount: 1, minimumCount: 2 }).event).toBeNull();
    expect(evaluateCoverageTransition({ state: 'alerting', cycle: 1, observedCount: 2, minimumCount: 2 })).toEqual({ nextState: 'healthy', nextCycle: 1, event: 'resolved' });
    expect(evaluateCoverageTransition({ state: 'healthy', cycle: 1, observedCount: 0, minimumCount: 2 }).nextCycle).toBe(2);
  });

  it('orders notification severity', () => {
    expect(severityMeetsMinimum('important', 'attention')).toBe(true);
    expect(severityMeetsMinimum('informational', 'attention')).toBe(false);
  });
});
