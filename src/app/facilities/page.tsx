import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { EmptyState, PageHeader, ResultsSummary, StatusBadge, type StatusTone } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

type FacilitySearchParams = { q?: string; status?: string; sort?: string };

function statusTone(status: string): StatusTone {
  const normalized = status.toLowerCase();
  if (normalized === 'active') return 'positive';
  if (normalized.includes('review')) return 'warning';
  if (normalized === 'inactive') return 'neutral';
  return 'info';
}

export default async function FacilitiesPage({ searchParams }: { searchParams?: Promise<FacilitySearchParams> }) {
  const principal = await requirePagePermission('operations:read');
  const params: FacilitySearchParams = await Promise.resolve(searchParams ?? {});
  const query = params.q?.trim().toLowerCase() ?? '';
  const status = params.status?.trim() ?? '';
  const sort = params.sort === 'city' || params.sort === 'status' ? params.sort : 'name';
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getFacilities(principal);
  const sourceRows = state.data ?? [];
  const statuses = [...new Set(sourceRows.map((row) => row.status))].sort();
  const rows = sourceRows
    .filter((facility) => {
      const searchable = `${facility.facilityName} ${facility.city} ${facility.facilityType} ${facility.specialty}`.toLowerCase();
      return (!query || searchable.includes(query)) && (!status || facility.status === status);
    })
    .sort((left, right) => {
      if (sort === 'city') return left.city.localeCompare(right.city) || left.facilityName.localeCompare(right.facilityName);
      if (sort === 'status') return left.status.localeCompare(right.status) || left.facilityName.localeCompare(right.facilityName);
      return left.facilityName.localeCompare(right.facilityName);
    });
  const activeFilters = [query, status, sort !== 'name' ? sort : ''].filter(Boolean).length;

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <PageHeader eyebrow="Operations" title="Facilities" summary="Review facility details, specialties, and the freshness of the latest availability check." />

      <form className="filter-bar" method="get" action="/facilities" aria-label="Facility filters">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem_14rem]">
          <label className="form-label">
            Search
            <input className="form-control" name="q" defaultValue={query} placeholder="Facility, city, type, specialty" />
          </label>
          <label className="form-label">
            Status
            <select className="form-control" name="status" defaultValue={status}>
              <option value="">All statuses</option>
              {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="form-label">
            Sort by
            <select className="form-control" name="sort" defaultValue={sort}>
              <option value="name">Facility name</option>
              <option value="city">City</option>
              <option value="status">Status</option>
            </select>
          </label>
        </div>
        <div className="filter-actions">
          <ResultsSummary count={rows.length} noun="facility" activeFilters={activeFilters} />
          <div className="flex gap-2">
            {activeFilters ? <Link className="button button-secondary" href="/facilities">Clear filters</Link> : null}
            <button className="button button-primary" type="submit">Apply filters</button>
          </div>
        </div>
      </form>

      {rows.length ? (
        <section className="table-shell" aria-labelledby="facility-results-heading">
          <div className="border-b border-slate-300 px-4 py-3">
            <h2 id="facility-results-heading" className="section-title">Facility records</h2>
          </div>
          <div className="table-scroll">
            <table className="data-table min-w-[58rem]">
              <thead>
                <tr>
                  <th scope="col">Facility</th>
                  <th scope="col">City</th>
                  <th scope="col">Type</th>
                  <th scope="col">Specialty</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last verified</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((facility) => (
                  <tr key={facility.facilityId}>
                    <td className="font-semibold text-slate-950">{facility.facilityName}</td>
                    <td>{facility.city}</td>
                    <td>{facility.facilityType}</td>
                    <td>{facility.specialty || 'Not recorded'}</td>
                    <td><StatusBadge tone={statusTone(facility.status)}>{facility.status}</StatusBadge></td>
                    <td className="whitespace-nowrap">{facility.lastCallDate ? formatDate(facility.lastCallDate) : 'Not verified'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : state.ok ? (
        <EmptyState
          title={activeFilters ? 'No facilities match these filters' : 'No facility records'}
          description={activeFilters ? 'Clear one or more filters and try again.' : 'Facility records will appear here after data is imported.'}
          action={activeFilters ? <Link className="button button-secondary" href="/facilities">Clear filters</Link> : undefined}
        />
      ) : null}
    </AppShell>
  );
}
