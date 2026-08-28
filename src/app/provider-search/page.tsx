import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { ProviderExportButton } from '@/components/provider-export-button';
import { EmptyState, InlineMessage, PageHeader, ResultsSummary, StatusBadge, type StatusTone } from '@/components/ui';
import { formatDate, humanizeKey } from '@/lib/format';
import { canExportProviderDirectory } from '@/lib/governance';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';
import { getServerConfig } from '@/server/config';

type ProviderSearchParams = {
  memberZip?: string;
  radius?: string;
  diagnosis?: string;
  specialty?: string;
  accepting?: string;
  scheduling?: string;
  urgentReferral?: string;
  freshness?: string;
  facilityName?: string;
  verifiedFrom?: string;
  verifiedTo?: string;
  sort?: string;
  page?: string;
};

const answerValues = ['yes', 'no', 'unknown', 'not_asked', 'unable_to_verify', 'not_applicable'] as const;
type AnswerValue = (typeof answerValues)[number];
const freshnessValues = ['fresh', 'aging', 'stale', 'never_verified'] as const;
const sortValues = ['recommended', 'distance', 'recently_verified', 'soonest_availability', 'name'] as const;

function answer(value: string | undefined): AnswerValue | undefined {
  return answerValues.find((item) => item === value);
}

function statusTone(value: string): StatusTone {
  if (value === 'yes' || value === 'fresh') return 'positive';
  if (value === 'no') return 'danger';
  if (value === 'stale' || value === 'aging') return 'warning';
  return 'neutral';
}

function qualityLabel(value: string): string {
  if (value === 'zip_centroid') return 'ZIP-centroid distance';
  if (value === 'address') return 'Address-level distance';
  if (value === 'exact') return 'Exact geocode distance';
  if (value === 'manual') return 'Manually entered coordinates';
  return 'Coordinate quality not recorded';
}

function pageHref(params: ProviderSearchParams, page: number): string {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (raw && key !== 'page') query.set(key, raw);
  }
  query.set('page', String(page));
  return `/provider-search?${query.toString()}`;
}

export default async function ProviderSearchPage({ searchParams }: { searchParams?: Promise<ProviderSearchParams> }) {
  const principal = await requirePagePermission('operations:read');
  const params: ProviderSearchParams = await Promise.resolve(searchParams ?? {});
  const memberZip = params.memberZip?.trim() || '04530';
  const radius = Number(params.radius ?? '50');
  const diagnosis = params.diagnosis?.trim() ?? '';
  const specialty = params.specialty?.trim() ?? '';
  const accepting = answer(params.accepting);
  const scheduling = answer(params.scheduling);
  const urgentReferral = answer(params.urgentReferral);
  const freshness = freshnessValues.find((item) => item === params.freshness);
  const sort = sortValues.find((item) => item === params.sort) ?? 'recommended';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getProviderSearch(principal, {
    memberZip,
    radius,
    diagnosis,
    specialty,
    accepting,
    scheduling,
    urgentReferral,
    freshness,
    facilityName: params.facilityName?.trim(),
    verifiedFrom: params.verifiedFrom || undefined,
    verifiedTo: params.verifiedTo || undefined,
    sort,
    page,
    pageSize: 25,
  });
  const resultPage = state.data;
  const results = resultPage?.rows ?? [];
  const activeFilters = [diagnosis, specialty, accepting, scheduling, urgentReferral, freshness, params.facilityName, params.verifiedFrom, params.verifiedTo].filter(Boolean).length;
  const totalPages = resultPage ? Math.max(1, Math.ceil(resultPage.total / resultPage.pageSize)) : 1;

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <PageHeader eyebrow="Operations" title="Provider search" summary="Find facilities by location and current verified capability. Distance and status are calculated from server records." />

      <form method="get" action="/provider-search" className="filter-bar" aria-label="Provider search filters">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="form-label">Member ZIP<input name="memberZip" defaultValue={memberZip} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required className="form-control" /></label>
          <label className="form-label">Radius<select name="radius" defaultValue={radius} className="form-control"><option value={25}>25 miles</option><option value={50}>50 miles</option><option value={100}>100 miles</option><option value={150}>150 miles</option></select></label>
          <label className="form-label">Specialty<input name="specialty" defaultValue={specialty} className="form-control" placeholder="Oncology" /></label>
          <label className="form-label">Diagnosis<input name="diagnosis" defaultValue={diagnosis} className="form-control" placeholder="Code or description" /></label>
          <label className="form-label">Facility name<input name="facilityName" defaultValue={params.facilityName} className="form-control" /></label>
          <label className="form-label">Accepting<select name="accepting" defaultValue={accepting ?? ''} className="form-control"><option value="">Any status</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option><option value="unable_to_verify">Unable to verify</option><option value="not_applicable">Not applicable</option></select></label>
          <label className="form-label">Scheduling within four weeks<select name="scheduling" defaultValue={scheduling ?? ''} className="form-control"><option value="">Any status</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option><option value="unable_to_verify">Unable to verify</option><option value="not_applicable">Not applicable</option></select></label>
          <label className="form-label">Urgent referral required<select name="urgentReferral" defaultValue={urgentReferral ?? ''} className="form-control"><option value="">Any status</option><option value="yes">Required</option><option value="no">Not required</option><option value="unknown">Unknown</option></select></label>
          <label className="form-label">Verification freshness<select name="freshness" defaultValue={freshness ?? ''} className="form-control"><option value="">Any age</option><option value="fresh">Fresh</option><option value="aging">Aging</option><option value="stale">Stale</option><option value="never_verified">Never verified</option></select></label>
          <label className="form-label">Verified from<input name="verifiedFrom" type="date" defaultValue={params.verifiedFrom} className="form-control" /></label>
          <label className="form-label">Verified through<input name="verifiedTo" type="date" defaultValue={params.verifiedTo} className="form-control" /></label>
          <label className="form-label">Sort by<select name="sort" defaultValue={sort} className="form-control"><option value="recommended">Recommended</option><option value="distance">Distance</option><option value="recently_verified">Recently verified</option><option value="soonest_availability">Soonest availability</option><option value="name">Name</option></select></label>
        </div>
        <div className="filter-actions"><ResultsSummary count={resultPage?.total ?? 0} noun="facility" activeFilters={activeFilters} /><div className="flex gap-2"><Link className="button button-secondary" href="/provider-search">Reset</Link><button type="submit" className="button button-primary">Search</button></div></div>
      </form>

      {dataMode === 'database' && canExportProviderDirectory(principal.role) ? <ProviderExportButton
        maximumRows={getServerConfig().EXPORT_MAX_ROWS}
        filters={{
          memberZip,
          radius,
          diagnosis: diagnosis || undefined,
          specialty: specialty || undefined,
          accepting,
          scheduling,
          urgentReferral,
          freshness,
          facilityName: params.facilityName?.trim() || undefined,
          verifiedFrom: params.verifiedFrom || undefined,
          verifiedTo: params.verifiedTo || undefined,
          sort,
        }}
      /> : null}

      {resultPage && !resultPage.originFound ? <InlineMessage tone="warning" title="ZIP not available">No validated coordinate was found for {memberZip}. Add the ZIP centroid before running a radius search.</InlineMessage> : null}
      {resultPage?.excludedForMissingCoordinates ? <InlineMessage tone="info">{resultPage.excludedForMissingCoordinates} active {resultPage.excludedForMissingCoordinates === 1 ? 'facility was' : 'facilities were'} excluded because coordinates are missing.</InlineMessage> : null}

      {results.length ? (
        <section className="table-shell" aria-labelledby="provider-results-heading">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 px-4 py-3"><h2 id="provider-results-heading" className="section-title">Search results</h2><p className="text-xs text-slate-500">Page {page} of {totalPages}</p></div>
          <div className="table-scroll"><table className="data-table min-w-[76rem]">
            <thead><tr><th scope="col">Facility</th><th scope="col">Why it matched</th><th scope="col">Current status</th><th scope="col">Availability</th><th scope="col">Distance</th><th scope="col">Contact</th></tr></thead>
            <tbody>{results.map((result) => (
              <tr key={result.facilityId}>
                <td>{dataMode === 'database' ? <Link className="font-semibold text-slate-950 underline-offset-2 hover:underline" href={`/facilities/${result.facilityId}`}>{result.facilityName}</Link> : <span className="font-semibold text-slate-950">{result.facilityName}</span>}<span className="block text-xs text-slate-500">{result.city}{result.stateCode ? `, ${result.stateCode}` : ''} · {result.specialties}</span></td>
                <td><ul className="space-y-1 text-sm">{result.matchReasons.slice(0, 4).map((reason) => <li key={reason}>· {reason}</li>)}</ul></td>
                <td><StatusBadge tone={statusTone(result.acceptingStatus)}>Accepting: {humanizeKey(result.acceptingStatus)}</StatusBadge><span className="mt-2 block text-xs text-slate-600">Scheduling: {humanizeKey(result.schedulingStatus)}</span><span className="mt-1 block text-xs text-slate-600">Urgent referral required: {humanizeKey(result.urgentReferralStatus)}</span></td>
                <td><StatusBadge tone={statusTone(result.freshness)}>{humanizeKey(result.freshness)}</StatusBadge><span className="mt-2 block text-xs text-slate-600">{result.freshnessLabel}</span>{result.nextAvailableDate ? <span className="mt-1 block text-xs text-slate-600">Next date: {formatDate(result.nextAvailableDate)}</span> : null}{result.estimatedWaitDays !== null ? <span className="mt-1 block text-xs text-slate-600">Wait: {result.estimatedWaitDays} days</span> : null}</td>
                <td className="whitespace-nowrap"><span className="font-medium">{result.distanceMiles.toFixed(1)} mi</span><span className="mt-1 block text-xs text-slate-500">{qualityLabel(result.coordinateQuality)}</span></td>
                <td className="whitespace-nowrap">{result.phone || 'Not recorded'}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {totalPages > 1 ? <nav className="flex items-center justify-between border-t border-slate-300 px-4 py-3" aria-label="Search result pages">{page > 1 ? <Link className="button button-secondary" href={pageHref(params, page - 1)}>Previous</Link> : <span />}{page < totalPages ? <Link className="button button-secondary" href={pageHref(params, page + 1)}>Next</Link> : <span />}</nav> : null}
        </section>
      ) : resultPage?.originFound && state.ok ? <EmptyState title="No facilities match this search" description="Check the ZIP, widen the radius, or remove a filter." action={<Link className="button button-secondary" href="/provider-search">Reset search</Link>} /> : null}
    </AppShell>
  );
}
