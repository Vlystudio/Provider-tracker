import { describe, expect, it } from 'vitest';
import { getDemoReports } from './demo-data';

describe('demo report filtering', () => {
  it('uses the selected date range for report totals and denominators', () => {
    const report = getDemoReports('2026-05-02', '2026-05-03');

    expect(report.total).toBe(2);
    expect(report.period).toEqual({ from: '2026-05-02', to: '2026-05-03' });
    expect(report.metrics).toEqual([
      { label: 'Calls recorded', value: '2', detail: 'Calls logged in the selected period' },
      { label: 'Availability met', value: '0', detail: '0 of 2 calls' },
      { label: 'Unable to contact', value: '1', detail: '1 of 2 calls' },
      { label: 'Did not meet', value: '1', detail: '1 of 2 calls' },
    ]);
  });

  it('returns zeroed metrics for a range with no calls', () => {
    const report = getDemoReports('2026-06-01', '2026-06-30');

    expect(report.total).toBe(0);
    expect(report.metrics.every((metric) => metric.value === '0')).toBe(true);
  });
});
