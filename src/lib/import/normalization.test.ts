import { describe, expect, it } from 'vitest';
import {
  cleanText,
  deriveResult,
  excelSerialToDate,
  makeFacilityIdentity,
  normalizePhone,
  normalizePostalCode,
  parseWorkbookDate,
  toAvailabilityStatus,
  toScheduleStatus,
  toTreatmentStatus,
  weekStartForDate,
} from './normalization';

describe('workbook normalization', () => {
  it('repairs workbook encoding debris, whitespace, and pipe spacing', () => {
    expect(cleanText('  MaineHealth\u00a0Cancer Â  Care| Brunswick ')).toBe(
      'MaineHealth Cancer Care | Brunswick',
    );
  });

  it('creates a stable facility identity without changing its display text', () => {
    const identity = makeFacilityIdentity(' New England Cancer Specialists ', ' TOPSHAM ');
    expect(identity.displayKey).toBe('New England Cancer Specialists | TOPSHAM');
    expect(identity.normalizedKey).toBe('new england cancer specialists|topsham');
  });

  it('normalizes phones and leading-zero ZIP codes', () => {
    expect(normalizePhone('(207) 555-1212 ext. 9')).toBe('2075551212x9');
    expect(normalizePostalCode(3901)).toBe('03901');
  });

  it('normalizes workbook status aliases', () => {
    expect(toAvailabilityStatus('Unkown')).toBe('unknown');
    expect(toAvailabilityStatus('N/A')).toBe('not_applicable');
    expect(toTreatmentStatus('Unable to tell w/out triage')).toBe('unable_to_tell_without_triage');
    expect(toScheduleStatus('Yes can schedule w/in 4 weeks with urgent referral')).toBe(
      'urgent_referral_required',
    );
  });
});

describe('workbook date conversion', () => {
  it('treats Excel serials as Eastern wall time, including daylight saving time', () => {
    expect(excelSerialToDate(46146.5, '1900')?.toISOString()).toBe('2026-05-04T16:00:00.000Z');
  });

  it('uses Monday as the duplicate-detection week start', () => {
    expect(weekStartForDate(new Date('2026-05-07T14:00:00.000Z'))).toBe('2026-05-04');
  });

  it('rejects dates with an ambiguous two-digit year', () => {
    expect(parseWorkbookDate('03/04/05', '1900')).toBeNull();
  });
});

describe('canonical import results', () => {
  it('recalculates urgent success instead of trusting cached output phrases', () => {
    expect(
      deriveResult({
        didNotLeaveVm: false,
        accepting: 'yes',
        canTreat: 'yes',
        schedule: 'urgent_referral_required',
      }),
    ).toEqual({
      resultCode: 'meets_availability_guidelines_urgent',
      resultPhrase: 'meets availability guidelines - can schedule within 4 weeks with urgent referral',
    });
  });
});
