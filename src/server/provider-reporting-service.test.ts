import { describe, expect, it } from 'vitest';
import { reportingInputSchema } from './provider-reporting-service';

describe('provider reporting input', () => {
  it('uses one inclusive calendar-date contract for every report', () => {
    expect(reportingInputSchema.parse({ from: '2026-08-01', to: '2026-08-21', drilldown: 'accepting' })).toEqual({
      from: '2026-08-01', to: '2026-08-21', drilldown: 'accepting',
    });
  });

  it('rejects reversed periods and unsupported drill-downs', () => {
    expect(() => reportingInputSchema.parse({ from: '2026-08-22', to: '2026-08-21' })).toThrow();
    expect(() => reportingInputSchema.parse({ from: '2026-08-01', to: '2026-08-21', drilldown: 'made_up' })).toThrow();
  });
});
