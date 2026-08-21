import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { EmptyState, InlineMessage, PageHeader, ResultsSummary, StatusBadge, type StatusTone } from '@/components/ui';
import { providerSearchValidation } from '@/lib/domain';
import { formatDate, humanizeKey } from '@/lib/format';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

type ProviderSearchParams = {
  memberZip?: string;
  radius?: string;
  diagnosis?: string;
  specialty?: string;
  sort?: string;
};

function availabilityTone(value: string): StatusTone {
  const normalized = value.toLowerCase();
  if (normalized === 'yes' || normalized.includes('accepting')) return 'positive';
  if (normalized === 'no' || normalized.includes('no current')) return 'danger';
  return 'warning';
}

function verificationLabel(value: string | null): string {
  if (!value) return 'Not verified';
  const date = new Date(`${value}T00:00:00.000Z`);
  const days = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 86_400_000));
  if (days > 30) return `Verification overdue · ${formatDate(value)}`;
  if (days === 0) return `Verified today · ${formatDate(value)}`;
  return `Verified ${days} ${days === 1 ? 'day' : 'days'} ago · ${formatDate(value)}`;
}

function verificationIsOverdue(value: string | null): boolean {
  return Boolean(value) && Date.now() - new Date(`${value}T00:00:00.000Z`).valueOf() > 30 * 86_400_000;
}

export default async function ProviderSearchPage({ searchParams }: { searchParams?: Promise<ProviderSearchParams> }) {
  const principal = await requirePagePermission('operations:read');
  const params: ProviderSearchParams = await Promise.resolve(searchParams ?? {});
  const memberZip = params.memberZip?.trim() || '04530';
  const radius = Number(params.radius ?? '50');
  const diagnosis = params.diagnosis === undefined ? 'J45' : params.diagnosis.trim();
  const specialty = params.specialty?.trim() || '';
  const sort = params.sort === 'facility_name' || params.sort === 'last_call_date' ? params.sort : 'distance';
  const validation = providerSearchValidation({
    memberZip,
    radius,
    diagnosis: diagnosis || undefined,
    specialty: specialty || undefined,
  });
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getProviderSearch(principal, {
    memberZip,
    radius,
    diagnosis: validation.success ? diagnosis : undefined,
    specialty: validation.success ? specialty : undefined,
    sort,
    page: 1,
    pageSize: 50,
  });
  const results = validation.success ? state.data ?? [] : [];
  const activeFilters = [memberZip, radius, diagnosis, specialty, sort !== 'distance' ? sort : ''].filter(Boolean).length;

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok && validation.success ? state.message : null}>
      <PageHeader
        eyebrow="Operations"
        title="Provider search"
        summary="Search by member location and clinical need. Results explain the current availability signal and when it was last checked."
      />

      <form method="get" action="/provider-search" className="filter-bar" aria-label="Provider search filters">
        <div className="filter-grid xl:grid-cols-5">
          <label className="form-label">
            Member ZIP
            <input
              name="memberZip"
              defaultValue={memberZip}
              inputMode="numeric"
              maxLength={5}
              required
              aria-invalid={!validation.success}
              aria-describedby={!validation.success ? 'provider-search-error' : undefined}
              className="form-control"
            />
          </label>
          <label className="form-label">
            Radius
            <select name="radius" defaultValue={radius} className="form-control">
              <option value={25}>25 miles</option>
              <option value={50}>50 miles</option>
              <option value={100}>100 miles</option>
              <option value={150}>150 miles</option>
            </select>
          </label>
          <label className="form-label">
            Diagnosis
            <input name="diagnosis" defaultValue={diagnosis} className="form-control" />
          </label>
          <label className="form-label">
            Specialty <span className="font-normal text-slate-500">(optional)</span>
            <input name="specialty" defaultValue={specialty} className="form-control" placeholder="Example: Pulmonology" />
          </label>
          <label className="form-label">
            Sort by
            <select name="sort" defaultValue={sort} className="form-control">
              <option value="distance">Distance</option>
              <option value="facility_name">Facility name</option>
              <option value="last_call_date">Last verified</option>
            </select>
          </label>
        </div>

        {!validation.success ? (
          <div id="provider-search-error" className="mt-4">
            <InlineMessage tone="error" role="alert">{validation.error}</InlineMessage>
          </div>
        ) : null}

        <div className="filter-actions">
          <ResultsSummary count={results.length} noun="provider" activeFilters={activeFilters} />
          <div className="flex gap-2">
            <Link className="button button-secondary" href="/provider-search">Reset</Link>
            <button type="submit" className="button button-primary">Search providers</button>
          </div>
        </div>
      </form>

      {results.length ? (
        <section className="table-shell" aria-labelledby="provider-results-heading">
          <div className="border-b border-slate-300 px-4 py-3">
            <h2 id="provider-results-heading" className="section-title">Search results</h2>
          </div>
          <div className="table-scroll">
            <table className="data-table min-w-[64rem]">
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Match</th>
                  <th scope="col">Availability</th>
                  <th scope="col">Verification</th>
                  <th scope="col">Distance</th>
                  <th scope="col">Phone</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.facilityId}>
                    <td>
                      <span className="block font-semibold text-slate-950">{result.facilityName}</span>
                      <span className="block text-xs text-slate-500">{result.city} · {result.specialty}</span>
                    </td>
                    <td>
                      <span className="block">{humanizeKey(result.latestTreatmentStatus)} for diagnosis</span>
                      <span className="mt-1 block text-xs text-slate-500">{result.recommendation}</span>
                    </td>
                    <td>
                      <StatusBadge tone={availabilityTone(result.latestAcceptingStatus)}>{result.latestAcceptingStatus}</StatusBadge>
                      <span className="mt-2 block text-xs text-slate-500">Scheduling: {humanizeKey(result.latestSchedulingStatus)}</span>
                    </td>
                    <td>
                      <span className={verificationIsOverdue(result.lastCallDate) ? 'font-medium text-amber-800' : undefined}>
                        {verificationLabel(result.lastCallDate)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">{result.distanceMiles.toFixed(1)} mi</td>
                    <td className="whitespace-nowrap">{result.phone || 'Not recorded'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : validation.success && state.ok ? (
        <EmptyState
          title="No providers match this search"
          description="Check the ZIP, widen the radius, or remove a clinical filter."
          action={<Link className="button button-secondary" href="/provider-search">Reset search</Link>}
        />
      ) : null}
    </AppShell>
  );
}
