import Link from 'next/link';
import { AuthorizationEditor, type AuthorizationView } from '@/components/authorization-editor';
import { AppShell } from '@/components/app-shell';
import { EmptyState, PageHeader, ResultsSummary, StatusBadge, type StatusTone } from '@/components/ui';
import { can } from '@/lib/access-control';
import { formatDateTime } from '@/lib/format';
import { requirePagePermission } from '@/server/authorization';
import { listAuthorizationsForPrincipal } from '@/server/authorization-service';
import { getResolvedDataMode } from '@/server/data-layer';

type AuthorizationSearchParams = { id?: string; number?: string; q?: string; status?: string };

function statusTone(status: string): StatusTone {
  if (status === 'complete') return 'positive';
  if (status === 'cancelled') return 'neutral';
  return 'info';
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default async function AuthorizationSummaryPage({ searchParams }: { searchParams?: Promise<AuthorizationSearchParams> }) {
  const principal = await requirePagePermission('operations:read');
  const params: AuthorizationSearchParams = await Promise.resolve(searchParams ?? {});
  const query = params.q?.trim().toLowerCase() ?? '';
  const status = params.status === 'open' || params.status === 'complete' || params.status === 'cancelled' ? params.status : '';
  let records: Awaited<ReturnType<typeof listAuthorizationsForPrincipal>> = [];
  let loadError: string | null = null;

  try {
    records = await listAuthorizationsForPrincipal(principal);
  } catch {
    loadError = 'Authorizations could not be loaded. Try again or ask IT to check the database service.';
  }

  const filtered = records.filter((record) => {
    const matchesQuery = !query || record.authorizationNumber.toLowerCase().includes(query) || record.memberZip?.includes(query);
    return matchesQuery && (!status || record.status === status);
  });
  const selected = records.find((record) => record.id === params.id)
    ?? records.find((record) => record.authorizationNumber === params.number)
    ?? filtered[0]
    ?? null;
  const activeFilters = Number(Boolean(query)) + Number(Boolean(status));
  const editable = can(principal.role, 'operations:write');

  return (
    <AppShell user={principal} dataMode={getResolvedDataMode()} statusMessage={loadError}>
      <PageHeader
        eyebrow="Operations"
        title="Authorizations"
        summary={principal.role === 'admin' ? 'Review and update authorization records across the team.' : 'Review and update the authorization records assigned to you.'}
      />

      <form className="filter-bar" method="get" action="/authorization-summary" aria-label="Authorization filters">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <label className="form-label">
            Search
            <input className="form-control" name="q" defaultValue={query} placeholder="Authorization number or ZIP" />
          </label>
          <label className="form-label">
            Status
            <select className="form-control" name="status" defaultValue={status}>
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="complete">Complete</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        <div className="filter-actions">
          <ResultsSummary count={filtered.length} noun="authorization" activeFilters={activeFilters} />
          <div className="flex gap-2">
            {activeFilters ? <Link className="button button-secondary" href="/authorization-summary">Clear</Link> : null}
            <button className="button button-primary" type="submit">Apply</button>
          </div>
        </div>
      </form>

      {records.length ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(31rem,0.95fr)_minmax(0,1.05fr)]">
          <section className="table-shell" aria-labelledby="authorization-list-heading">
            <div className="border-b border-slate-300 px-4 py-3">
              <h2 id="authorization-list-heading" className="section-title">Records</h2>
            </div>
            {filtered.length ? (
              <div className="table-scroll max-h-[34rem]">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Authorization</th>
                      <th scope="col">Member ZIP</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((record) => (
                      <tr key={record.id} className={selected?.id === record.id ? 'bg-blue-50' : undefined}>
                        <td>
                          <span className="block font-semibold text-slate-950">{record.authorizationNumber}</span>
                          <span className="block text-xs text-slate-500">Updated {formatDateTime(record.updatedAt)}</span>
                        </td>
                        <td>{record.memberZip ?? 'Not recorded'}</td>
                        <td><StatusBadge tone={statusTone(record.status)}>{statusLabel(record.status)}</StatusBadge></td>
                        <td className="text-right">
                          <Link className="button-link" href={`/authorization-summary?id=${record.id}`}>Open</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-5">
                <EmptyState title="No matching authorizations" description="Clear one or more filters and try again." action={<Link className="button button-secondary" href="/authorization-summary">Clear filters</Link>} />
              </div>
            )}
          </section>

          {selected ? (
            <section className="panel p-5" aria-labelledby="authorization-detail-heading">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div>
                  <p className="page-kicker">Selected authorization</p>
                  <h2 id="authorization-detail-heading" className="mt-1 text-xl font-semibold text-slate-950">{selected.authorizationNumber}</h2>
                </div>
                <StatusBadge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</StatusBadge>
              </div>
              <AuthorizationEditor
                key={selected.id}
                editable={editable}
                record={{
                  id: selected.id,
                  authorizationNumber: selected.authorizationNumber,
                  memberZip: selected.memberZip,
                  status: selected.status,
                  referralReasonDetail: selected.referralReasonDetail,
                  updatedAt: selected.updatedAt.toISOString(),
                } satisfies AuthorizationView}
              />
            </section>
          ) : null}
        </div>
      ) : !loadError ? (
        <EmptyState
          title="No authorizations assigned"
          description={principal.role === 'admin' ? 'Authorization records will appear after data is imported or entered.' : 'You do not have any authorization records assigned to you.'}
          action={<Link className="button button-secondary" href="/provider-search">Search providers</Link>}
        />
      ) : null}
    </AppShell>
  );
}
