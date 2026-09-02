import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { CallLogGroups } from '@/components/call-log-groups';
import { EmptyState, InlineMessage, PageHeader } from '@/components/ui';
import { can } from '@/lib/access-control';
import { groupCallsByTrackingId } from '@/lib/call-log';
import { callLogStatuses } from '@/server/call-service';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

type CallLogSearchParams = { q?: string; status?: string; from?: string; to?: string; sort?: string; saved?: string; page?: string };

function pageHref(params: CallLogSearchParams, page: number) {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.sort) query.set('sort', params.sort);
  query.set('page', String(page));
  return `/call-log?${query.toString()}`;
}

export default async function CallLogPage({ searchParams }: { searchParams?: Promise<CallLogSearchParams> }) {
  const principal = await requirePagePermission('operations:read');
  const params: CallLogSearchParams = await Promise.resolve(searchParams ?? {});
  const query = params.q?.trim().toLowerCase() ?? '';
  const status = params.status?.trim() ?? '';
  const from = params.from?.trim() ?? '';
  const to = params.to?.trim() ?? '';
  const sort = params.sort === 'date_asc' || params.sort === 'provider' ? params.sort : 'date_desc';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getCallLog(principal, {
    query: query || undefined,
    status: callLogStatuses.includes(status as (typeof callLogStatuses)[number]) ? status as (typeof callLogStatuses)[number] : undefined,
    from: from || undefined,
    to: to || undefined,
    sort,
    page,
    pageSize: 25,
  });
  const data = state.data ?? { rows: [], totalCalls: 0, totalGroups: 0, page, pageSize: 25 };
  const rows = data.rows;
  const callGroups = groupCallsByTrackingId(rows);
  const totalPages = Math.max(1, Math.ceil(data.totalGroups / data.pageSize));
  const activeFilters = [query, status, from, to, sort !== 'date_desc' ? sort : ''].filter(Boolean).length;

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <PageHeader
        eyebrow="Operations"
        title="Call log"
        summary="Calls are grouped by their system-generated Tracking ID. Open one to see its facility calls."
        meta={can(principal.role, 'operations:write') ? <Link className="button button-primary" href="/new-call">Enter calls</Link> : null}
      />
      {params.saved === '1' ? <InlineMessage tone="success" role="status">Call saved.</InlineMessage> : null}

      <form className="filter-bar" method="get" action="/call-log" aria-label="Call log filters">
        <div className="filter-grid xl:grid-cols-5">
          <label className="form-label">
            Search
            <input className="form-control" name="q" defaultValue={query} placeholder="Tracking ID, provider, outcome" />
          </label>
          <label className="form-label">
            Status
            <select className="form-control" name="status" defaultValue={status}>
              <option value="">All statuses</option>
              {callLogStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="form-label">
            From
            <input className="form-control" name="from" type="date" defaultValue={from} />
          </label>
          <label className="form-label">
            To
            <input className="form-control" name="to" type="date" defaultValue={to} />
          </label>
          <label className="form-label">
            Sort by
            <select className="form-control" name="sort" defaultValue={sort}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="provider">Provider name</option>
            </select>
          </label>
        </div>
        <div className="filter-actions">
          <p className="text-sm text-slate-600" role="status">
            {data.totalGroups} {data.totalGroups === 1 ? 'tracking group' : 'tracking groups'}, {data.totalCalls} {data.totalCalls === 1 ? 'call' : 'calls'}{activeFilters ? ' in matching groups' : ''}
            {activeFilters ? `, ${activeFilters} active ${activeFilters === 1 ? 'filter' : 'filters'}` : ''}
          </p>
          <div className="flex gap-2">
            {activeFilters ? <Link className="button button-secondary" href="/call-log">Clear filters</Link> : null}
            <button className="button button-primary" type="submit">Apply filters</button>
          </div>
        </div>
      </form>

      {rows.length ? (
        <section className="table-shell" aria-labelledby="call-log-results-heading">
          <div className="flex items-center justify-between gap-4 border-b border-slate-300 px-4 py-3">
            <h2 id="call-log-results-heading" className="section-title">Calls by Tracking ID</h2>
            <p className="text-xs text-slate-500">Select a Tracking ID to view its calls</p>
          </div>
          <CallLogGroups groups={callGroups} />
          {totalPages > 1 ? (
            <nav className="flex items-center justify-between border-t border-slate-300 px-4 py-3" aria-label="Call log pages">
              {data.page > 1 ? <Link className="button button-secondary" href={pageHref(params, data.page - 1)}>Previous</Link> : <span />}
              <p className="text-xs text-slate-500">Page {data.page} of {totalPages}</p>
              {data.page < totalPages ? <Link className="button button-secondary" href={pageHref(params, data.page + 1)}>Next</Link> : <span />}
            </nav>
          ) : null}
        </section>
      ) : state.ok ? (
        <EmptyState
          title={activeFilters ? 'No calls match these filters' : 'No calls recorded'}
          description={activeFilters ? 'Clear one or more filters and try again.' : 'Call records will appear here after they are saved.'}
          action={activeFilters
            ? <Link className="button button-secondary" href="/call-log">Clear filters</Link>
            : can(principal.role, 'operations:write') ? <Link className="button button-primary" href="/new-call">Enter calls</Link> : undefined}
        />
      ) : null}
    </AppShell>
  );
}
