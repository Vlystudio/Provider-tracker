import { describe, expect, it } from 'vitest';
import { providerSearchInputSchema } from './provider-search-service';

describe('provider search input', () => {
  it('accepts supported operational filters and paging', () => {
    const result = providerSearchInputSchema.parse({
      memberZip: '04103',
      radius: '50',
      specialty: 'Oncology',
      diagnosis: 'C50',
      accepting: 'yes',
      scheduling: 'yes',
      urgentReferral: 'no',
      freshness: 'fresh',
      page: '2',
      pageSize: '25',
      sort: 'recommended',
    });
    expect(result.radius).toBe(50);
    expect(result.page).toBe(2);
    expect(result.availability).toBe('available_or_review');
  });

  it('supports the confirmed-unavailable and all-facilities views', () => {
    expect(providerSearchInputSchema.parse({ memberZip: '04103', availability: 'confirmed_unavailable' }).availability).toBe('confirmed_unavailable');
    expect(providerSearchInputSchema.parse({ memberZip: '04103', availability: 'all' }).availability).toBe('all');
  });

  it('rejects unsupported filters, invalid ZIPs, and unbounded pages', () => {
    expect(() => providerSearchInputSchema.parse({ memberZip: '4103' })).toThrow();
    expect(() => providerSearchInputSchema.parse({ memberZip: '04103', pageSize: 101 })).toThrow();
    expect(() => providerSearchInputSchema.parse({ memberZip: '04103', distanceFromClient: 2 })).toThrow();
  });

  it('treats blank optional text as absent', () => {
    const result = providerSearchInputSchema.parse({ memberZip: '04103', specialty: '  ' });
    expect(result.specialty).toBeUndefined();
  });
});
