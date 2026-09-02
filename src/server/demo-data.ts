import { providerResults, reviewQueue, callLogRows, facilityRows, statCards } from '@/lib/mock-data';
import type { DashboardSummary } from '@/lib/dashboard';

export type ProviderSearchResult = {
  facilityId: string;
  facilityName: string;
  city: string;
  distanceMiles: number;
  phone: string;
  specialty: string;
  latestAcceptingStatus: string;
  latestTreatmentStatus: string;
  latestSchedulingStatus: string;
  lastCallDate: string | null;
  recommendation: string;
  coordinateProvenance: string;
  dataQualityStatus: string;
};

export function getDemoDashboard(): DashboardSummary {
  return {
    cards: statCards,
    reliability: {
      activeFacilities: 4,
      callsThisWeek: 12,
      activeWork: 3,
      availabilityDue: 2,
      freshAccepting: 1,
      confirmedUnavailable: 1,
      unconfirmedAvailability: 1,
      importantChanges: 1,
    },
  };
}
export function getDemoProviderResults() {
  return providerResults.map((result, index) => ({
    facilityId: `demo-${result.facility.toLowerCase().replace(/\s+/g, '-')}`,
    facilityName: result.facility,
    city: result.city,
    stateCode: 'ME',
    postalCode: index === 0 ? '04011' : index === 1 ? '04530' : '04086',
    distanceMiles: Number.parseFloat(result.distance),
    phone: result.phone,
    specialties: result.specialty,
    specialtyMatch: true,
    diagnosisMatch: index !== 1,
    acceptingStatus: result.status.includes('Accepting') ? ('yes' as const) : ('no' as const),
    schedulingStatus: index === 1 ? ('no' as const) : ('yes' as const),
    urgentReferralStatus: index === 2 ? ('yes' as const) : ('no' as const),
    nextAvailableDate: index === 0 ? '2026-08-28' : index === 1 ? '2027-01-01' : null,
    estimatedWaitDays: index === 0 ? 7 : index === 2 ? 18 : 60,
    acceptingVerifiedAt: index === 0 ? '2026-08-19T14:00:00.000Z' : index === 1 ? '2026-06-01T14:00:00.000Z' : null,
    availabilityReviewDueAt: index === 0 ? '2026-09-18T14:00:00.000Z' : index === 1 ? '2027-01-01T00:00:00.000Z' : null,
    lastVerifiedAt: index === 0 ? '2026-08-19T14:00:00.000Z' : index === 1 ? '2026-06-01T14:00:00.000Z' : null,
    freshness: index === 0 ? ('fresh' as const) : index === 1 ? ('stale' as const) : ('never_verified' as const),
    freshnessLabel: index === 0 ? 'Verified 2 days ago' : index === 1 ? 'Stale · verified 81 days ago' : 'Never verified',
    coordinateQuality: 'zip_centroid',
    coordinateProvenance: 'demo_zip_centroid',
    dataQualityStatus: 'clean',
    rankScore: 90 - index * 15,
    matchReasons: index === 0
      ? ['Specialty match', 'Treats diagnosis', 'Accepting new patients', 'Schedules within four weeks']
      : index === 1
        ? ['Specialty match', 'Stale · verified 81 days ago']
        : ['Specialty match', 'Treats diagnosis', 'Urgent referral required', 'Never verified'],
    optimisticLockVersion: 0,
  }));
}

export function getDemoCallLog() {
  return callLogRows;
}

export function getDemoFacilities() {
  return facilityRows.map((facility, index) => ({
    facilityId: `demo-${facility.name.toLowerCase().replace(/\s+/g, '-')}`,
    facilityName: facility.name,
    city: facility.city,
    facilityType: facility.type,
    specialties: facility.specialty,
    acceptingStatus: index === 1 ? ('no' as const) : ('yes' as const),
    freshness: index === 0 ? ('fresh' as const) : index === 1 ? ('aging' as const) : index === 2 ? ('never_verified' as const) : ('stale' as const),
    freshnessLabel: index === 0 ? 'Verified 2 days ago' : index === 1 ? 'Aging · verified 38 days ago' : index === 2 ? 'Never verified' : 'Stale · verified 70 days ago',
    recordStatus: facility.status === 'Needs review' ? ('Needs review' as const) : ('Active' as const),
    lastVerifiedAt: index === 2 ? null : index === 0 ? '2026-08-19T14:00:00.000Z' : '2026-06-12T14:00:00.000Z',
    dataQualityStatus: 'clean',
  }));
}

export function getDemoReviewQueue() {
  return reviewQueue;
}

export function getDemoReports(from = '2026-05-01', to = '2026-05-31', drilldown?: string) {
  const facilities = getDemoFacilities();
  const activeFacilities = facilities.filter((facility) => facility.recordStatus === 'Active');
  const freshFacilities = activeFacilities.filter((facility) => facility.freshness === 'fresh');
  const recentlyVerified = facilities.filter((facility) => facility.freshness === 'fresh' || facility.freshness === 'aging');
  const acceptingFacilities = recentlyVerified.filter((facility) => facility.acceptingStatus === 'yes');
  const verificationEvents = [
    { date: '2026-05-05', facilityName: 'Brunswick Clinic', acceptingStatus: 'yes', previousAcceptingStatus: 'unknown', estimatedWaitDays: 7 },
    { date: '2026-05-12', facilityName: 'Topsham Specialty', acceptingStatus: 'no', previousAcceptingStatus: 'yes', estimatedWaitDays: 60 },
    { date: '2026-05-12', facilityName: 'Midcoast Center', acceptingStatus: 'unknown', previousAcceptingStatus: 'unknown', estimatedWaitDays: null },
    { date: '2026-05-20', facilityName: 'MaineHealth Cancer Care', acceptingStatus: 'yes', previousAcceptingStatus: 'yes', estimatedWaitDays: 18 },
    { date: '2026-05-27', facilityName: 'Brunswick Clinic', acceptingStatus: 'yes', previousAcceptingStatus: 'yes', estimatedWaitDays: null },
  ].filter((event) => event.date >= from && event.date <= to);
  const phoneContacts = [
    { date: '2026-05-05', verified: true },
    { date: '2026-05-12', verified: false },
    { date: '2026-05-20', verified: true },
    { date: '2026-05-27', verified: false },
  ].filter((contact) => contact.date >= from && contact.date <= to);
  const assignments = [
    { date: '2026-05-05', completed: true },
    { date: '2026-05-10', completed: true },
    { date: '2026-05-22', completed: false },
  ].filter((assignment) => assignment.date >= from && assignment.date <= to);
  const successfulContacts = phoneContacts.filter((contact) => contact.verified);
  const completedAssignments = assignments.filter((assignment) => assignment.completed);
  const newlyAccepting = verificationEvents.filter((event) => event.acceptingStatus === 'yes' && event.previousAcceptingStatus !== 'yes');
  const becameUnavailable = verificationEvents.filter((event) => event.acceptingStatus === 'no' && event.previousAcceptingStatus === 'yes');
  const waitDays = verificationEvents.map((event) => event.estimatedWaitDays).filter((value): value is number => value !== null);
  const percent = (numerator: number, denominator: number) => denominator ? `${Math.round((numerator / denominator) * 100)}%` : '—';
  const demoDrilldown = facilities.filter((facility) => {
    if (drilldown === 'fresh') return facility.freshness === 'fresh';
    if (drilldown === 'accepting') return facility.acceptingStatus === 'yes' && facility.freshness !== 'never_verified';
    if (drilldown === 'stale') return facility.freshness === 'stale';
    if (drilldown === 'newly_accepting') return newlyAccepting.some((event) => event.facilityName === facility.facilityName);
    if (drilldown === 'became_unavailable') return becameUnavailable.some((event) => event.facilityName === facility.facilityName);
    return false;
  });
  const query = new URLSearchParams({ from, to });
  const metricHref = (kind: string) => `/reports?${query.toString()}&drilldown=${kind}`;
  return {
    metrics: [
      { label: 'Fresh accepting status', value: percent(freshFacilities.length, activeFacilities.length), detail: `${freshFacilities.length} of ${activeFacilities.length} active facilities were verified in the last 30 days`, href: metricHref('fresh') },
      { label: 'Currently accepting', value: percent(acceptingFacilities.length, recentlyVerified.length), detail: `${acceptingFacilities.length} of ${recentlyVerified.length} recently verified facilities are accepting`, href: metricHref('accepting') },
      { label: 'Phone contact success', value: percent(successfulContacts.length, phoneContacts.length), detail: `${successfulContacts.length} successful phone verifications out of ${phoneContacts.length} recorded phone contacts` },
      { label: 'Reverification completed', value: percent(completedAssignments.length, assignments.length), detail: `${completedAssignments.length} of ${assignments.length} assignments created in the period were completed` },
      { label: 'Verifications recorded', value: String(verificationEvents.length), detail: 'Verification events in the selected period' },
      { label: 'Newly accepting', value: String(newlyAccepting.length), detail: 'Changed from unavailable or unknown to accepting', href: metricHref('newly_accepting') },
      { label: 'Became unavailable', value: String(becameUnavailable.length), detail: 'Changed from accepting to not accepting', href: metricHref('became_unavailable') },
      { label: 'Average wait', value: waitDays.length ? `${(waitDays.reduce((total, value) => total + value, 0) / waitDays.length).toFixed(1)} days` : '—', detail: `${waitDays.length} verification events included a wait estimate` },
    ],
    generatedAt: new Date().toISOString(),
    period: { from, to },
    total: verificationEvents.length,
    trend: [...new Set([...verificationEvents.map((event) => event.date), ...phoneContacts.map((contact) => contact.date)])].sort().map((date) => {
      const dayContacts = phoneContacts.filter((contact) => contact.date === date);
      const daySuccessful = dayContacts.filter((contact) => contact.verified).length;
      return { date, verifications: verificationEvents.filter((event) => event.date === date).length, successfulContacts: daySuccessful, failedContacts: dayContacts.length - daySuccessful };
    }),
    coverage: [
      { specialty: 'Cardiology', facilities: 1, fresh: 0, accepting: 0 },
      { specialty: 'Oncology', facilities: 1, fresh: 0, accepting: 0 },
      { specialty: 'Pulmonology', facilities: 1, fresh: 1, accepting: 1 },
    ],
    drilldown: demoDrilldown.map((facility) => ({
      facilityId: facility.facilityId,
      facilityName: facility.facilityName,
      city: facility.city,
      acceptingStatus: facility.acceptingStatus,
      lastVerifiedAt: facility.lastVerifiedAt,
    })),
  };
}
