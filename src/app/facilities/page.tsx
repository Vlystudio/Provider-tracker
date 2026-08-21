import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { EmptyState, PageHeader, ResultsSummary, StatusBadge, type StatusTone } from '@/components/ui';
import { humanizeKey } from '@/lib/format';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

type FacilitySearchParams = { q?: string; status?: string; freshness?: string; sort?: string; page?: string };

function tone(value: string): StatusTone {
  if (value === 'Active' || value === 'fresh' || value === 'yes') return 'positive';
  if (value === 'Needs review' || value === 'aging' || value === 'stale') return 'warning';
  if (value === 'no') return 'danger';
  return 'neutral';
}

function pageHref(params: FacilitySearchParams, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value && key !== 'page') query.set(key, value);
  query.set('page', String(page));
  return `/facilities?${query.toString()}`;
}

export default async function FacilitiesPage({ searchParams }: { searchParams?: Promise<FacilitySearchParams> }) {
  const principal = await requirePagePermission('operations:read');
  const params: FacilitySearchParams = await Promise.resolve(searchParams ?? {});
  const status = params.status === 'active' || params.status === 'needs_review' || params.status === 'archived' ? params.status : undefined;
  const freshness = params.freshness === 'fresh' || params.freshness === 'aging' || params.freshness === 'stale' || params.freshness === 'never_verified' ? params.freshness : undefined;
  const sort = params.sort === 'city' || params.sort === 'freshness' || params.sort === 'last_verified' ? params.sort : 'name';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getFacilities(principal, { query: params.q, status, freshness, sort, page, pageSize: 25 });
  const resultPage = state.data;
  const rows = resultPage?.rows ?? [];
  const activeFilters = [params.q, status, freshness, sort !== 'name' ? sort : ''].filter(Boolean).length;
  const totalPages = resultPage ? Math.max(1, Math.ceil(resultPage.total / resultPage.pageSize)) : 1;

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <PageHeader eyebrow="Operations" title="Facilities" summary="Find the current facility record, see verification age, and open its history." />
      <form className="filter-bar" method="get" action="/facilities" aria-label="Facility filters">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="form-label">Search<input className="form-control" name="q" defaultValue={params.q} placeholder="Facility, city, type, specialty" /></label>
          <label className="form-label">Record status<select className="form-control" name="status" defaultValue={status ?? ''}><option value="">All records</option><option value="active">Active</option><option value="needs_review">Needs review</option><option value="archived">Archived</option></select></label>
          <label className="form-label">Verification freshness<select className="form-control" name="freshness" defaultValue={freshness ?? ''}><option value="">Any age</option><option value="fresh">Fresh</option><option value="aging">Aging</option><option value="stale">Stale</option><option value="never_verified">Never verified</option></select></label>
          <label className="form-label">Sort by<select className="form-control" name="sort" defaultValue={sort}><option value="name">Facility name</option><option value="city">City</option><option value="freshness">Oldest verification</option><option value="last_verified">Recently verified</option></select></label>
        </div>
        <div className="filter-actions"><ResultsSummary count={resultPage?.total ?? 0} noun="facility" activeFilters={activeFilters} /><div className="flex gap-2">{activeFilters ? <Link className="button button-secondary" href="/facilities">Clear filters</Link> : null}<button className="button button-primary" type="submit">Apply filters</button></div></div>
      </form>

      {rows.length ? (
        <section className="table-shell" aria-labelledby="facility-results-heading">
          <div className="flex items-center justify-between border-b border-slate-300 px-4 py-3"><h2 id="facility-results-heading" className="section-title">Facility records</h2><p className="text-xs text-slate-500">Page {page} of {totalPages}</p></div>
          <div className="table-scroll"><table className="data-table min-w-[64rem]"><thead><tr><th scope="col">Facility</th><th scope="col">Type</th><th scope="col">Specialties</th><th scope="col">Accepting</th><th scope="col">Verification</th><th scope="col">Record</th></tr></thead><tbody>{rows.map((facility) => (
            <tr key={facility.facilityId}><td><Link className="font-semibold text-slate-950 underline-offset-2 hover:underline" href={`/facilities/${facility.facilityId}`}>{facility.facilityName}</Link><span className="block text-xs text-slate-500">{facility.city}</span></td><td>{facility.facilityType}</td><td>{facility.specialties}</td><td><StatusBadge tone={tone(facility.acceptingStatus)}>{humanizeKey(facility.acceptingStatus)}</StatusBadge></td><td><StatusBadge tone={tone(facility.freshness)}>{humanizeKey(facility.freshness)}</StatusBadge><span className="mt-1 block text-xs text-slate-500">{facility.freshnessLabel}</span></td><td><StatusBadge tone={tone(facility.recordStatus)}>{facility.recordStatus}</StatusBadge></td></tr>
          ))}</tbody></table></div>
          {totalPages > 1 ? <nav className="flex items-center justify-between border-t border-slate-300 px-4 py-3" aria-label="Facility pages">{page > 1 ? <Link className="button button-secondary" href={pageHref(params, page - 1)}>Previous</Link> : <span />}{page < totalPages ? <Link className="button button-secondary" href={pageHref(params, page + 1)}>Next</Link> : <span />}</nav> : null}
        </section>
      ) : state.ok ? <EmptyState title={activeFilters ? 'No facilities match these filters' : 'No facility records'} description={activeFilters ? 'Clear one or more filters and try again.' : 'Facility records will appear here after data is imported.'} action={activeFilters ? <Link className="button button-secondary" href="/facilities">Clear filters</Link> : undefined} /> : null}
    </AppShell>
  );
}
