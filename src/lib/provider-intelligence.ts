export const verificationAnswers = [
  'yes',
  'no',
  'unknown',
  'not_asked',
  'unable_to_verify',
  'not_applicable',
] as const;

export type VerificationAnswer = (typeof verificationAnswers)[number];
export type VerificationCategory = 'accepting' | 'scheduling' | 'specialty' | 'diagnosis' | 'contact';
export type FreshnessState = 'fresh' | 'aging' | 'stale' | 'never_verified';

export type FreshnessThreshold = { freshDays: number; staleDays: number };
export type FreshnessPolicy = Record<VerificationCategory, FreshnessThreshold>;

export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  accepting: { freshDays: 30, staleDays: 45 },
  scheduling: { freshDays: 30, staleDays: 45 },
  diagnosis: { freshDays: 90, staleDays: 120 },
  specialty: { freshDays: 180, staleDays: 240 },
  contact: { freshDays: 180, staleDays: 365 },
};

const DAY_MS = 86_400_000;

export function parseFreshnessPolicy(
  values: Partial<Record<`${Uppercase<VerificationCategory>}_FRESH_DAYS` | `${Uppercase<VerificationCategory>}_STALE_DAYS`, string | number | undefined>>,
): FreshnessPolicy {
  const policy = structuredClone(DEFAULT_FRESHNESS_POLICY);
  for (const category of Object.keys(policy) as VerificationCategory[]) {
    const prefix = category.toUpperCase() as Uppercase<VerificationCategory>;
    const fresh = Number(values[`${prefix}_FRESH_DAYS`]);
    const stale = Number(values[`${prefix}_STALE_DAYS`]);
    if (Number.isInteger(fresh) && fresh > 0) policy[category].freshDays = fresh;
    if (Number.isInteger(stale) && stale > 0) policy[category].staleDays = stale;
    if (policy[category].staleDays < policy[category].freshDays) {
      throw new Error(`${category} stale days must be greater than or equal to fresh days.`);
    }
  }
  return policy;
}

export function verificationAgeDays(verifiedAt: Date | string | null, now = new Date()): number | null {
  if (!verifiedAt) return null;
  const date = verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt);
  if (Number.isNaN(date.valueOf())) return null;
  return Math.max(0, Math.floor((now.valueOf() - date.valueOf()) / DAY_MS));
}

export function classifyFreshness(
  category: VerificationCategory,
  verifiedAt: Date | string | null,
  now = new Date(),
  policy = DEFAULT_FRESHNESS_POLICY,
): { state: FreshnessState; ageDays: number | null } {
  const ageDays = verificationAgeDays(verifiedAt, now);
  if (ageDays === null) return { state: 'never_verified', ageDays };
  const threshold = policy[category];
  if (ageDays <= threshold.freshDays) return { state: 'fresh', ageDays };
  if (ageDays <= threshold.staleDays) return { state: 'aging', ageDays };
  return { state: 'stale', ageDays };
}

export function freshnessLabel(freshness: ReturnType<typeof classifyFreshness>): string {
  if (freshness.state === 'never_verified') return 'Never verified';
  if (freshness.ageDays === 0) return 'Verified today';
  const age = `${freshness.ageDays} ${freshness.ageDays === 1 ? 'day' : 'days'} ago`;
  if (freshness.state === 'stale') return `Stale · verified ${age}`;
  if (freshness.state === 'aging') return `Aging · verified ${age}`;
  return `Verified ${age}`;
}

export function isPositiveVerification(value: VerificationAnswer | null | undefined): boolean {
  return value === 'yes';
}

export type PriorityInput = {
  acceptingVerifiedAt: Date | string | null;
  specialtyVerifiedAt?: Date | string | null;
  diagnosisVerifiedAt?: Date | string | null;
  schedulingVerifiedAt?: Date | string | null;
  acceptingStatus: VerificationAnswer;
  unresolvedUnknowns: number;
  recentCallCount: number;
  recentFailedContacts: number;
  hasConflict: boolean;
};

export function calculateReverificationPriority(
  input: PriorityInput,
  now = new Date(),
  policy = DEFAULT_FRESHNESS_POLICY,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const accepting = classifyFreshness('accepting', input.acceptingVerifiedAt, now, policy);
  if (accepting.state === 'never_verified') {
    score += 50;
    reasons.push('Never verified');
  } else if (accepting.state === 'stale') {
    score += 35;
    reasons.push('Accepting status stale');
  } else if (accepting.state === 'aging') {
    score += 15;
    reasons.push('Accepting status aging');
  }

  const categoryChecks: Array<[VerificationCategory, Date | string | null | undefined, string]> = [
    ['specialty', input.specialtyVerifiedAt, 'Specialty confirmation stale'],
    ['diagnosis', input.diagnosisVerifiedAt, 'Diagnosis capability stale'],
    ['scheduling', input.schedulingVerifiedAt, 'Scheduling status stale'],
  ];
  for (const [category, date, reason] of categoryChecks) {
    if (date === undefined) continue;
    const state = classifyFreshness(category, date ?? null, now, policy).state;
    if (state === 'stale' || state === 'never_verified') {
      score += 12;
      reasons.push(reason);
    }
  }

  if (input.hasConflict) {
    score += 25;
    reasons.push('Conflicting status');
  }
  if (input.recentCallCount >= 10) {
    score += 15;
    reasons.push('High usage');
  } else if (input.recentCallCount >= 3) {
    score += 7;
    reasons.push('Regularly used');
  }
  if (input.unresolvedUnknowns > 0) {
    score += Math.min(15, input.unresolvedUnknowns * 5);
    reasons.push(`${input.unresolvedUnknowns} ${input.unresolvedUnknowns === 1 ? 'field needs' : 'fields need'} verification`);
  }
  if (input.recentFailedContacts >= 2) {
    score += Math.min(10, input.recentFailedContacts * 2);
    reasons.push('Repeated contact failures');
  }
  return { score: Math.min(100, score), reasons };
}

export type SearchRankingInput = {
  facilityId: string;
  specialtyMatch: boolean;
  diagnosisMatch: boolean;
  acceptingStatus: VerificationAnswer;
  schedulingStatus: VerificationAnswer;
  urgentReferralStatus: VerificationAnswer;
  acceptingVerifiedAt: Date | string | null;
  distanceMiles: number | null;
  estimatedWaitDays: number | null;
  completeness: number;
};

export function rankSearchResult(
  input: SearchRankingInput,
  now = new Date(),
  policy = DEFAULT_FRESHNESS_POLICY,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (input.specialtyMatch) {
    score += 30;
    reasons.push('Specialty match');
  }
  if (input.diagnosisMatch) {
    score += 35;
    reasons.push('Treats diagnosis');
  }
  if (input.acceptingStatus === 'yes') {
    score += 20;
    reasons.push('Accepting new patients');
  }
  if (input.schedulingStatus === 'yes') {
    score += 12;
    reasons.push('Schedules within four weeks');
  }
  if (input.urgentReferralStatus === 'yes') {
    score += 4;
    reasons.push('Urgent referrals accepted');
  }
  const freshness = classifyFreshness('accepting', input.acceptingVerifiedAt, now, policy);
  if (freshness.state === 'fresh') score += 12;
  else if (freshness.state === 'aging') score += 5;
  else if (freshness.state === 'stale') score -= 8;
  else score -= 12;
  if (freshness.state !== 'fresh') reasons.push(freshnessLabel(freshness));
  if (input.distanceMiles !== null) score += Math.max(0, 12 - input.distanceMiles / 10);
  if (input.estimatedWaitDays !== null && input.estimatedWaitDays <= 28) score += 6;
  score += Math.max(0, Math.min(1, input.completeness)) * 5;
  return { score: Math.round(score * 10) / 10, reasons };
}

export type QualityIssue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  label: string;
};

export type FacilityQualityInput = {
  phoneNormalized: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  latitude: number | null;
  longitude: number | null;
  lastVerifiedAt: Date | string | null;
  nextAvailableDate: Date | string | null;
  hasUnresolvedDuplicate: boolean;
  hasConflictingAcceptingStatus: boolean;
};

export function assessFacilityQuality(
  input: FacilityQualityInput,
  now = new Date(),
  policy = DEFAULT_FRESHNESS_POLICY,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (!input.phoneNormalized) issues.push({ code: 'missing_phone', severity: 'error', label: 'Phone missing' });
  else if (!/^\d{10,15}$/.test(input.phoneNormalized)) issues.push({ code: 'invalid_phone', severity: 'error', label: 'Phone format invalid' });
  if (!input.postalCode) issues.push({ code: 'missing_zip', severity: 'error', label: 'ZIP missing' });
  else if (!/^\d{5}(?:-\d{4})?$/.test(input.postalCode)) issues.push({ code: 'invalid_zip', severity: 'error', label: 'ZIP format invalid' });
  if (!input.addressLine1) issues.push({ code: 'missing_address', severity: 'warning', label: 'Street address missing' });
  if (input.latitude === null || input.longitude === null) issues.push({ code: 'missing_coordinates', severity: 'warning', label: 'Coordinates missing' });
  const freshness = classifyFreshness('accepting', input.lastVerifiedAt, now, policy);
  if (freshness.state === 'never_verified') issues.push({ code: 'never_verified', severity: 'warning', label: 'Never verified' });
  if (freshness.state === 'stale') issues.push({ code: 'stale_verification', severity: 'warning', label: 'Verification stale' });
  if (input.lastVerifiedAt && new Date(input.lastVerifiedAt).valueOf() > now.valueOf() + DAY_MS) {
    issues.push({ code: 'future_verification', severity: 'error', label: 'Verification date is in the future' });
  }
  if (input.nextAvailableDate && new Date(input.nextAvailableDate).valueOf() < now.valueOf() - DAY_MS) {
    issues.push({ code: 'past_availability_date', severity: 'warning', label: 'Next available date has passed' });
  }
  if (input.hasUnresolvedDuplicate) issues.push({ code: 'duplicate_candidate', severity: 'warning', label: 'Possible duplicate' });
  if (input.hasConflictingAcceptingStatus) issues.push({ code: 'conflicting_status', severity: 'error', label: 'Recent accepting statuses conflict' });
  return issues;
}

export type DuplicateInput = {
  id: string;
  normalizedName: string;
  normalizedCity: string;
  phoneNormalized: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
};

function same(valueA: string | null, valueB: string | null): boolean {
  return Boolean(valueA && valueB && valueA === valueB);
}

export function duplicateSignals(left: DuplicateInput, right: DuplicateInput): {
  score: number;
  confidence: 'exact' | 'probable' | 'possible' | null;
  reasons: string[];
} {
  if (left.id === right.id) return { score: 0, confidence: null, reasons: [] };
  let score = 0;
  const reasons: string[] = [];
  if (left.normalizedName === right.normalizedName) {
    score += 45;
    reasons.push('Same normalized name');
  }
  if (left.normalizedCity === right.normalizedCity) {
    score += 15;
    reasons.push('Same city');
  }
  if (same(left.phoneNormalized, right.phoneNormalized)) {
    score += 35;
    reasons.push('Same phone');
  }
  if (same(left.postalCode?.slice(0, 5) ?? null, right.postalCode?.slice(0, 5) ?? null)) {
    score += 10;
    reasons.push('Same ZIP');
  }
  if (
    left.latitude !== null && left.longitude !== null && right.latitude !== null && right.longitude !== null
    && haversineMiles(left.latitude, left.longitude, right.latitude, right.longitude) <= 0.1
  ) {
    score += 20;
    reasons.push('Coordinates within 0.1 mile');
  }
  score = Math.min(100, score);
  const confidence = score >= 90 ? 'exact' : score >= 65 ? 'probable' : score >= 45 ? 'possible' : null;
  return { score, confidence, reasons };
}

export function haversineMiles(latA: number, lonA: number, latB: number, lonB: number): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.7613;
  const latitudeDelta = radians(latB - latA);
  const longitudeDelta = radians(lonB - lonA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type ReportPeriod = { from: Date; toExclusive: Date };

export function parseReportPeriod(from: string, to: string): ReportPeriod {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error('The report period is invalid.');
  }
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toExclusive = new Date(`${to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  if (Number.isNaN(fromDate.valueOf()) || Number.isNaN(toExclusive.valueOf())) throw new Error('The report period is invalid.');
  return { from: fromDate, toExclusive };
}

export function percentage(numerator: number, denominator: number): { numerator: number; denominator: number; percent: number | null } {
  return {
    numerator,
    denominator,
    percent: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10,
  };
}
