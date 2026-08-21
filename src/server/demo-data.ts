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
  return providerResults.map((result) => ({
    facilityId: `demo-${result.facility.toLowerCase().replace(/\s+/g, '-')}`,
    facilityName: result.facility,
    city: result.city,
    distanceMiles: Number.parseFloat(result.distance),
    phone: result.phone,
    specialty: result.specialty,
    latestAcceptingStatus: result.status,
    latestTreatmentStatus: 'yes',
    latestSchedulingStatus: 'yes',
    lastCallDate: '2026-05-04',
    recommendation: result.nextStep,
    coordinateProvenance: 'demo',
    dataQualityStatus: 'clean',
  }));
}

export function getDemoCallLog() {
  return callLogRows;
}

export function getDemoFacilities() {
  return facilityRows.map((facility) => ({
    facilityId: `demo-${facility.name.toLowerCase().replace(/\s+/g, '-')}`,
    facilityName: facility.name,
    city: facility.city,
    facilityType: facility.type,
    specialty: facility.specialty,
    status: facility.status,
    lastCallDate: '2026-05-04',
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
