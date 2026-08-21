import { describe, expect, it } from 'vitest';
import { qualityDashboardInputSchema } from './data-quality-service';

describe('data-quality filters', () => {
  it('accepts controlled issue groups and server paging', () => {
    expect(qualityDashboardInputSchema.parse({ issue: 'missing_coordinates', page: '2', pageSize: '25' })).toMatchObject({ issue: 'missing_coordinates', page: 2, pageSize: 25 });
  });

  it('rejects invented issue groups and excessive page sizes', () => {
    expect(() => qualityDashboardInputSchema.parse({ issue: 'auto_fix_everything' })).toThrow();
    expect(() => qualityDashboardInputSchema.parse({ pageSize: 1000 })).toThrow();
  });
});
