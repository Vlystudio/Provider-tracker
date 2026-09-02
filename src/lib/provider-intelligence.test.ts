import { describe, expect, it } from 'vitest';
import {
  assessFacilityQuality,
  availabilityHoldUntil,
  availabilityReviewDueAt,
  calculateReverificationPriority,
  classifyFreshness,
  duplicateSignals,
  freshnessLabel,
  haversineMiles,
  isPositiveVerification,
  isConfirmedUnavailableHold,
  parseFreshnessPolicy,
  parseReportPeriod,
  percentage,
  rankSearchResult,
} from './provider-intelligence';

const now = new Date('2026-08-21T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now.valueOf() - days * 86_400_000);

describe('verification freshness', () => {
  it('distinguishes fresh, aging, stale, and never verified values', () => {
    expect(classifyFreshness('accepting', null, now).state).toBe('never_verified');
    expect(classifyFreshness('accepting', daysAgo(30), now).state).toBe('fresh');
    expect(classifyFreshness('accepting', daysAgo(31), now).state).toBe('stale');
    expect(classifyFreshness('accepting', daysAgo(46), now).state).toBe('stale');
  });

  it('keeps confirmed long-term unavailability until its known review date', () => {
    const exact = {
      acceptingStatus: 'no' as const,
      acceptingVerifiedAt: daysAgo(1),
      nextAvailableDate: '2027-01-15',
    };
    expect(availabilityHoldUntil(exact)?.toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(isConfirmedUnavailableHold(exact, now)).toBe(true);

    const estimated = {
      acceptingStatus: 'yes' as const,
      schedulingStatus: 'no' as const,
      acceptingVerifiedAt: daysAgo(2),
      schedulingVerifiedAt: daysAgo(1),
      estimatedWaitDays: 180,
    };
    expect(availabilityHoldUntil(estimated)?.toISOString()).toBe('2027-02-16T12:00:00.000Z');
  });

  it('rechecks an unavailable facility after 30 days when the booking horizon is unknown', () => {
    const input = { acceptingStatus: 'no' as const, acceptingVerifiedAt: daysAgo(5) };
    expect(availabilityReviewDueAt(input)?.toISOString()).toBe('2026-09-15T12:00:00.000Z');
    expect(isConfirmedUnavailableHold(input, now)).toBe(true);
    expect(isConfirmedUnavailableHold(input, new Date('2026-09-16T12:00:00.000Z'))).toBe(false);
  });

  it('supports validated category-specific thresholds', () => {
    const policy = parseFreshnessPolicy({ ACCEPTING_FRESH_DAYS: '10', ACCEPTING_STALE_DAYS: '20' });
    expect(classifyFreshness('accepting', daysAgo(15), now, policy).state).toBe('aging');
    expect(() => parseFreshnessPolicy({ ACCEPTING_FRESH_DAYS: '30', ACCEPTING_STALE_DAYS: '20' })).toThrow();
  });

  it('uses direct freshness labels without inventing confidence', () => {
    expect(freshnessLabel(classifyFreshness('accepting', null, now))).toBe('Never verified');
    expect(freshnessLabel(classifyFreshness('accepting', now, now))).toBe('Verified today');
  });

  it('only treats an explicit yes as positive', () => {
    expect(isPositiveVerification('yes')).toBe(true);
    for (const value of ['no', 'unknown', 'not_asked', 'unable_to_verify', 'not_applicable'] as const) {
      expect(isPositiveVerification(value)).toBe(false);
    }
  });
});

describe('deterministic priority and ranking', () => {
  it('returns an explainable reverification score', () => {
    const result = calculateReverificationPriority({
      acceptingVerifiedAt: null,
      acceptingStatus: 'unknown',
      unresolvedUnknowns: 2,
      recentCallCount: 12,
      recentFailedContacts: 3,
      hasConflict: true,
    }, now);
    expect(result.score).toBe(100);
    expect(result.reasons).toEqual(expect.arrayContaining(['Never verified', 'High usage', 'Conflicting status']));
  });

  it('ranks explicit, fresh matches above unknown stale results', () => {
    const base = { facilityId: 'a', specialtyMatch: true, diagnosisMatch: true, distanceMiles: 10, estimatedWaitDays: 14, completeness: 1 };
    const strong = rankSearchResult({ ...base, acceptingStatus: 'yes', schedulingStatus: 'yes', urgentReferralStatus: 'no', acceptingVerifiedAt: daysAgo(2) }, now);
    const weak = rankSearchResult({ ...base, acceptingStatus: 'unknown', schedulingStatus: 'unknown', urgentReferralStatus: 'unknown', acceptingVerifiedAt: daysAgo(90) }, now);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.reasons).toContain('Treats diagnosis');
  });

  it('shows an urgent-referral requirement without boosting the provider rank', () => {
    const base = {
      facilityId: 'a', specialtyMatch: true, diagnosisMatch: true, acceptingStatus: 'yes' as const,
      schedulingStatus: 'yes' as const, acceptingVerifiedAt: daysAgo(2), distanceMiles: 10,
      estimatedWaitDays: 14, completeness: 1,
    };
    const required = rankSearchResult({ ...base, urgentReferralStatus: 'yes' }, now);
    const notRequired = rankSearchResult({ ...base, urgentReferralStatus: 'no' }, now);
    expect(required.score).toBe(notRequired.score);
    expect(required.reasons).toContain('Urgent referral required');
  });

  it('suppresses availability review while a future hold is active and restores it when due', () => {
    const input = {
      acceptingVerifiedAt: daysAgo(60),
      schedulingVerifiedAt: daysAgo(60),
      acceptingStatus: 'no' as const,
      schedulingStatus: 'no' as const,
      nextAvailableDate: '2026-12-01',
      unresolvedUnknowns: 0,
      recentCallCount: 0,
      recentFailedContacts: 0,
      hasConflict: false,
    };
    expect(calculateReverificationPriority(input, now).reasons).toEqual([]);
    expect(calculateReverificationPriority(input, new Date('2026-12-02T12:00:00.000Z')).reasons)
      .toContain('Confirmed availability date reached');
  });
});

describe('data quality and duplicates', () => {
  it('detects missing critical data, stale data, and impossible dates', () => {
    const issues = assessFacilityQuality({
      phoneNormalized: null,
      postalCode: 'bad',
      addressLine1: null,
      latitude: null,
      longitude: null,
      lastVerifiedAt: daysAgo(90),
      nextAvailableDate: daysAgo(2),
      hasUnresolvedDuplicate: true,
      hasConflictingAcceptingStatus: true,
    }, now);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'missing_phone', 'invalid_zip', 'missing_address', 'missing_coordinates', 'stale_verification',
      'past_availability_date', 'duplicate_candidate', 'conflicting_status',
    ]));
  });

  it('uses multiple exact signals for duplicate confidence', () => {
    const result = duplicateSignals(
      { id: 'a', normalizedName: 'clinic', normalizedCity: 'portland', phoneNormalized: '2075550100', postalCode: '04103', latitude: 43.68, longitude: -70.29 },
      { id: 'b', normalizedName: 'clinic', normalizedCity: 'portland', phoneNormalized: '2075550100', postalCode: '04103', latitude: 43.68, longitude: -70.29 },
    );
    expect(result.confidence).toBe('exact');
    expect(result.score).toBe(100);
  });

  it('does not classify a weak name-only signal as an automatic duplicate', () => {
    const result = duplicateSignals(
      { id: 'a', normalizedName: 'clinic', normalizedCity: 'portland', phoneNormalized: null, postalCode: null, latitude: null, longitude: null },
      { id: 'b', normalizedName: 'clinic', normalizedCity: 'bangor', phoneNormalized: null, postalCode: null, latitude: null, longitude: null },
    );
    expect(result.confidence).toBe('possible');
  });

  it('calculates representative distances in miles', () => {
    expect(haversineMiles(43.6591, -70.2568, 44.8012, -68.7778)).toBeGreaterThan(100);
  });
});

describe('reporting helpers', () => {
  it('uses an exclusive end boundary and explicit denominator', () => {
    const period = parseReportPeriod('2026-08-01', '2026-08-21');
    expect(period.toExclusive.toISOString()).toBe('2026-08-22T00:00:00.000Z');
    expect(percentage(3, 4)).toEqual({ numerator: 3, denominator: 4, percent: 75 });
    expect(percentage(0, 0).percent).toBeNull();
  });
});
