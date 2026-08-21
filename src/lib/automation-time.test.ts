import { describe, expect, it } from 'vitest';
import { dailyDigestPeriod, dueDailyRuns, dueWeeklyRuns, formatLocalDate, weeklyDigestPeriod, zonedDateTimeToUtc } from './automation-time';

describe('automation scheduling', () => {
  const zone = 'America/New_York';

  it('uses the configured zone instead of server-local time', () => {
    expect(formatLocalDate(new Date('2026-08-21T02:00:00Z'), zone)).toBe('2026-08-20');
    expect(zonedDateTimeToUtc('2026-08-21', 7, zone).toISOString()).toBe('2026-08-21T11:00:00.000Z');
  });

  it('preserves daily periods across both DST changes', () => {
    const spring = dailyDigestPeriod('2026-03-09', zone);
    const fall = dailyDigestPeriod('2026-11-02', zone);
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
    expect((fall.end.getTime() - fall.start.getTime()) / 3_600_000).toBe(25);
  });

  it('keeps weekly periods tied to local calendar dates', () => {
    const period = weeklyDigestPeriod('2026-03-09', zone);
    expect(formatLocalDate(period.start, zone)).toBe('2026-03-02');
    expect(formatLocalDate(period.end, zone)).toBe('2026-03-09');
  });

  it('recovers bounded missed daily runs with stable keys', () => {
    const runs = dueDailyRuns({ now: new Date('2026-08-21T12:00:00Z'), timeZone: zone, hour: 7, lastSuccessfulDate: '2026-08-18' });
    expect(runs.map((run) => run.executionKey)).toEqual(['daily:2026-08-19', 'daily:2026-08-20', 'daily:2026-08-21']);
  });

  it('runs the weekly job once after its scheduled time', () => {
    const before = dueWeeklyRuns({ now: new Date('2026-08-24T10:00:00Z'), timeZone: zone, hour: 7, weekday: 1 });
    const after = dueWeeklyRuns({ now: new Date('2026-08-24T12:00:00Z'), timeZone: zone, hour: 7, weekday: 1 });
    expect(before[0]?.dateKey).toBe('2026-08-17');
    expect(after[0]?.dateKey).toBe('2026-08-24');
  });
});
