import { describe, expect, it } from 'vitest';
import { migrationCsvCell } from './csv';

describe('migration diagnostic CSV', () => {
  it('neutralizes spreadsheet formulas and quotes fields', () => {
    expect(migrationCsvCell('=HYPERLINK("https://example.invalid")')).toBe('"\'=HYPERLINK(""https://example.invalid"")"');
    expect(migrationCsvCell('@SUM(A1:A2)')).toBe('"\'@SUM(A1:A2)"');
  });
});
