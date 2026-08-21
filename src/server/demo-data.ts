import { providerResults, reviewQueue, callLogRows, facilityRows, adminTasks, recentAuthorizations, statCards } from '@/lib/mock-data';

export type DashboardSummary = {
  cards: typeof statCards;
  recentAuthorizations: typeof recentAuthorizations;
  providerPreview: typeof providerResults;
  reviewPreview: typeof reviewQueue;
};

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
    recentAuthorizations,
    providerPreview: providerResults,
    reviewPreview: reviewQueue,
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
    nextAvailableDate: index === 0 ? '2026-08-28' : null,
    estimatedWaitDays: index === 0 ? 7 : index === 2 ? 18 : 60,
    acceptingVerifiedAt: index === 0 ? '2026-08-19T14:00:00.000Z' : index === 1 ? '2026-06-01T14:00:00.000Z' : null,
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
        : ['Specialty match', 'Treats diagnosis', 'Urgent referrals accepted', 'Never verified'],
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

export function getDemoReports(from = '2026-05-01', to = '2026-05-31') {
  const calls = callLogRows.filter((call) => call.date >= from && call.date <= to);
  const availabilityMet = calls.filter((call) => call.outcome.startsWith('meets availability')).length;
  const unableToContact = calls.filter((call) => call.outcome === 'unable to contact').length;
  const didNotMeet = calls.filter((call) => call.outcome === 'does not meet availability guidelines').length;
  return {
    metrics: [
      { label: 'Calls recorded', value: String(calls.length), detail: 'Calls logged in the selected period' },
      { label: 'Availability met', value: String(availabilityMet), detail: `${availabilityMet} of ${calls.length} calls` },
      { label: 'Unable to contact', value: String(unableToContact), detail: `${unableToContact} of ${calls.length} calls` },
      { label: 'Did not meet', value: String(didNotMeet), detail: `${didNotMeet} of ${calls.length} calls` },
    ],
    generatedAt: new Date().toISOString(),
    period: { from, to },
    total: calls.length,
  };
}

export function getDemoAdminOverview() {
  return {
    tasks: adminTasks,
    importBatches: [
      {
        batchId: 'demo-batch-001',
        fileName: 'URA_Provider_Availability_Tracker_USER_ACTIVE.xlsx',
        status: 'applied',
        rows: 248,
        rejected: 4,
        issues: 2,
      },
    ],
  };
}
