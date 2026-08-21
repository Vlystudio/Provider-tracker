import { describe, expect, it } from 'vitest';
import { getDemoReports } from './demo-data';

describe('demo report filtering', () => {
  it('uses the selected date range for report totals and denominators', () => {
    const report = getDemoReports('2026-05-05', '2026-05-12');

    expect(report.total).toBe(3);
    expect(report.period).toEqual({ from: '2026-05-05', to: '2026-05-12' });
    expect(report.metrics.find((metric) => metric.label === 'Phone contact success')).toMatchObject({ value: '50%', detail: '1 successful phone verifications out of 2 recorded phone contacts' });
    expect(report.metrics.find((metric) => metric.label === 'Verifications recorded')?.value).toBe('3');
    expect(report.metrics.find((metric) => metric.label === 'Newly accepting')?.value).toBe('1');
    expect(report.metrics.find((metric) => metric.label === 'Became unavailable')?.value).toBe('1');
    expect(report.trend).toEqual([
      { date: '2026-05-05', verifications: 1, successfulContacts: 1, failedContacts: 0 },
      { date: '2026-05-12', verifications: 2, successfulContacts: 0, failedContacts: 1 },
    ]);
  });

  it('does not invent period activity when a range has no calls', () => {
    const report = getDemoReports('2026-06-01', '2026-06-30');

    expect(report.total).toBe(0);
    expect(report.metrics.find((metric) => metric.label === 'Phone contact success')?.value).toBe('—');
    expect(report.metrics.find((metric) => metric.label === 'Verifications recorded')?.value).toBe('0');
    expect(report.metrics.find((metric) => metric.label === 'Average wait')?.value).toBe('—');
    expect(report.trend).toEqual([]);
  });
});
