import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { EmptyState, PageHeader, ResultsSummary, StatusBadge, type StatusTone } from '@/components/ui';
import { humanizeKey } from '@/lib/format';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';
import { listReverificationQueue } from '@/server/provider-intelligence-service';

type ReviewSearchParams = { q?: string; freshness?: string; assigned?: string; page?: string };

function priorityTone(score: number): StatusTone {
  if (score >= 70) return 'danger';
  if (score >= 40) return 'warning';
  return 'info';
}

function pageHref(params: ReviewSearchParams, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value && key !== 'page') query.set(key, value);
  query.set('page', String(page));
  return `/review-queue?${query.toString()}`;
}

export default async function ReviewQueuePage({ searchParams }: { searchParams?: Promise<ReviewSearchParams> }) {
  const principal = await requirePagePermission('operations:read');
  const params: ReviewSearchParams = await Promise.resolve(searchParams ?? {});
  const freshness = params.freshness === 'aging' || params.freshness === 'stale' || params.freshness === 'never_verified' ? params.freshness : undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const dataMode = getResolvedDataMode();
  let statusMessage: string | null = null;
  let data: {
    rows: Array<{ facilityId: string; facilityName: string; city: string; priority: { score: number; reasons: string[] }; acceptingFreshness: { state: string; ageDays: number | null }; assignment: { assignedName: string | null } | null }>;
    total: number; page: number; pageSize: number;
  };
  if (dataMode === 'database') {
    try {
      data = await listReverificationQueue(principal, { query: params.q, freshness, assignedTo: params.assigned === 'mine' ? principal.id : undefined, page, pageSize: 25 });
    } catch {
      data = { rows: [], total: 0, page, pageSize: 25 };
      statusMessage = 'The reverification queue could not be loaded.';
    }
  } else {
    const state = await getAppDataAdapter().getReviewQueue(principal);
    statusMessage = state.ok ? null : state.message ?? 'The queue could not be loaded.';
    const demoRows = (state.data ?? []).filter((item) => !params.q || `${item.facility} ${item.caseId} ${item.owner}`.toLowerCase().includes(params.q.toLowerCase()));
    data = { rows: demoRows.map((item, index) => ({ facilityId: `demo-${index}`, facilityName: item.facility, city: 'Maine', priority: { score: item.priority === 'danger' ? 80 : item.priority === 'warning' ? 50 : 25, reasons: [item.due] }, acceptingFreshness: { state: item.priority === 'danger' ? 'stale' : 'aging', ageDays: null }, assignment: { assignedName: item.owner } })), total: demoRows.length, page: 1, pageSize: 25 };
  }
  const activeFilters = [params.q, freshness, params.assigned].filter(Boolean).length;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={statusMessage}>
      <PageHeader eyebrow="Operations" title="Reverification queue" summary="Facilities with old, missing, or conflicting information. Priority reasons are shown in the queue." />
      <form className="filter-bar" method="get" action="/review-queue" aria-label="Reverification filters">
        <div className="grid gap-4 sm:grid-cols-3"><label className="form-label">Search<input className="form-control" name="q" defaultValue={params.q} placeholder="Facility or city" /></label><label className="form-label">Freshness<select className="form-control" name="freshness" defaultValue={freshness ?? ''}><option value="">Any age</option><option value="aging">Aging</option><option value="stale">Stale</option><option value="never_verified">Never verified</option></select></label><label className="form-label">Assignment<select className="form-control" name="assigned" defaultValue={params.assigned ?? ''}><option value="">All work</option><option value="mine">Assigned to me</option></select></label></div>
        <div className="filter-actions"><ResultsSummary count={data.total} noun="facility" activeFilters={activeFilters} /><div className="flex gap-2">{activeFilters ? <Link className="button button-secondary" href="/review-queue">Clear filters</Link> : null}<button className="button button-primary" type="submit">Apply filters</button></div></div>
      </form>
      {data.rows.length ? <section className="table-shell" aria-labelledby="queue-heading"><div className="flex items-center justify-between border-b border-slate-300 px-4 py-3"><h2 id="queue-heading" className="section-title">Work queue</h2><p className="text-xs text-slate-500">Page {data.page} of {totalPages}</p></div><div className="table-scroll"><table className="data-table min-w-[62rem]"><thead><tr><th scope="col">Facility</th><th scope="col">Priority</th><th scope="col">Why</th><th scope="col">Verification</th><th scope="col">Assigned to</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead><tbody>{data.rows.map((item) => <tr key={item.facilityId}><td><span className="font-semibold text-slate-950">{item.facilityName}</span><span className="block text-xs text-slate-500">{item.city}</span></td><td><StatusBadge tone={priorityTone(item.priority.score)}>{item.priority.score}</StatusBadge></td><td><ul className="space-y-1">{item.priority.reasons.slice(0, 4).map((reason) => <li key={reason}>· {reason}</li>)}</ul></td><td><StatusBadge tone={item.acceptingFreshness.state === 'stale' || item.acceptingFreshness.state === 'never_verified' ? 'warning' : 'neutral'}>{humanizeKey(item.acceptingFreshness.state)}</StatusBadge>{item.acceptingFreshness.ageDays !== null ? <span className="mt-1 block text-xs text-slate-500">{item.acceptingFreshness.ageDays} days old</span> : null}</td><td>{item.assignment?.assignedName || 'Unassigned'}</td><td className="text-right">{dataMode === 'database' ? <Link className="button-link" href={`/facilities/${item.facilityId}`}>Open</Link> : <span className="text-slate-400">Demo</span>}</td></tr>)}</tbody></table></div>{totalPages > 1 ? <nav className="flex items-center justify-between border-t border-slate-300 px-4 py-3" aria-label="Queue pages">{page > 1 ? <Link className="button button-secondary" href={pageHref(params, page - 1)}>Previous</Link> : <span />}{page < totalPages ? <Link className="button button-secondary" href={pageHref(params, page + 1)}>Next</Link> : <span />}</nav> : null}</section> : !statusMessage ? <EmptyState title="Nothing needs reverification" description="Facilities appear here when information is old, missing, or conflicting." /> : null}
    </AppShell>
  );
}
