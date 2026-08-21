import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { EmptyState, PageHeader, ResultsSummary, StatusBadge, type StatusTone } from '@/components/ui';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

type ReviewSearchParams = { q?: string; priority?: string };

function priorityTone(priority: string): StatusTone {
  if (priority === 'danger') return 'danger';
  if (priority === 'warning') return 'warning';
  return 'info';
}

export default async function ReviewQueuePage({ searchParams }: { searchParams?: Promise<ReviewSearchParams> }) {
  const principal = await requirePagePermission('operations:read');
  const params: ReviewSearchParams = await Promise.resolve(searchParams ?? {});
  const query = params.q?.trim().toLowerCase() ?? '';
  const priority = params.priority === 'danger' || params.priority === 'warning' || params.priority === 'info' ? params.priority : '';
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getReviewQueue(principal);
  const items = (state.data ?? []).filter((item) => {
    const searchable = `${item.facility} ${item.caseId} ${item.owner}`.toLowerCase();
    return (!query || searchable.includes(query)) && (!priority || item.priority === priority);
  });
  const activeFilters = Number(Boolean(query)) + Number(Boolean(priority));

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <PageHeader eyebrow="Operations" title="Review queue" summary="Items that need follow-up, ordered by urgency." />

      <form className="filter-bar" method="get" action="/review-queue" aria-label="Review queue filters">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <label className="form-label">
            Search
            <input className="form-control" name="q" defaultValue={query} placeholder="Facility, authorization, owner" />
          </label>
          <label className="form-label">
            Due status
            <select className="form-control" name="priority" defaultValue={priority}>
              <option value="">All items</option>
              <option value="danger">Overdue</option>
              <option value="warning">Due today</option>
              <option value="info">Upcoming</option>
            </select>
          </label>
        </div>
        <div className="filter-actions">
          <ResultsSummary count={items.length} noun="review" activeFilters={activeFilters} />
          <div className="flex gap-2">
            {activeFilters ? <Link className="button button-secondary" href="/review-queue">Clear filters</Link> : null}
            <button className="button button-primary" type="submit">Apply filters</button>
          </div>
        </div>
      </form>

      {items.length ? (
        <section className="table-shell" aria-labelledby="review-results-heading">
          <div className="border-b border-slate-300 px-4 py-3"><h2 id="review-results-heading" className="section-title">Follow-up items</h2></div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th scope="col">Facility</th><th scope="col">Authorization</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.caseId}>
                    <td className="font-semibold text-slate-950">{item.facility}</td>
                    <td>{item.caseId}</td>
                    <td>{item.owner}</td>
                    <td><StatusBadge tone={priorityTone(item.priority)}>{item.due}</StatusBadge></td>
                    <td className="text-right"><Link className="button-link" href={`/authorization-summary?number=${encodeURIComponent(item.caseId)}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : state.ok ? (
        <EmptyState
          title={activeFilters ? 'No reviews match these filters' : 'Nothing needs review'}
          description={activeFilters ? 'Clear one or more filters and try again.' : 'New follow-up items will appear here.'}
          action={activeFilters ? <Link className="button button-secondary" href="/review-queue">Clear filters</Link> : undefined}
        />
      ) : null}
    </AppShell>
  );
}
