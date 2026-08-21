import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { EmptyState, PageHeader, ResultsSummary, StatusBadge, type StatusTone } from '@/components/ui';
import { formatDateTime, humanizeKey } from '@/lib/format';
import { requirePagePermission } from '@/server/authorization';
import { listAuditEvents } from '@/server/audit-log';
import { getResolvedDataMode } from '@/server/data-layer';

type AuditSearchParams = {
  actor?: string;
  action?: string;
  result?: string;
  from?: string;
  to?: string;
};

function resultTone(result: string): StatusTone {
  if (result === 'success') return 'positive';
  if (result === 'blocked') return 'warning';
  if (result === 'failure') return 'danger';
  return 'neutral';
}

export default async function AuditPage({ searchParams }: { searchParams?: Promise<AuditSearchParams> }) {
  const principal = await requirePagePermission('audit:read');
  const params: AuditSearchParams = await Promise.resolve(searchParams ?? {});
  const normalized = {
    actor: params.actor ?? '',
    action: params.action ?? '',
    result: params.result === 'success' || params.result === 'failure' || params.result === 'blocked' ? params.result : '',
    from: params.from || undefined,
    to: params.to || undefined,
  } as const;
  const activeFilters = Object.values(normalized).filter(Boolean).length;
  let rows: Awaited<ReturnType<typeof listAuditEvents>>['rows'] = [];
  let loadError: string | null = null;

  try {
    ({ rows } = await listAuditEvents(principal, normalized));
  } catch {
    loadError = 'Audit events could not be loaded. Try again or ask IT to check the database service.';
  }

  return (
    <AppShell user={principal} dataMode={getResolvedDataMode()} statusMessage={loadError}>
      <PageHeader
        eyebrow="Oversight"
        title="Audit log"
        summary="Authentication, account, and authorization changes. Times are shown in Eastern Time."
        meta="Latest 100 events"
      />

      <form className="filter-bar" method="get" action="/audit" aria-label="Audit filters">
        <div className="filter-grid">
          <label className="form-label">
            Actor
            <input className="form-control" name="actor" defaultValue={normalized.actor} placeholder="Name or email" />
          </label>
          <label className="form-label">
            Action
            <input className="form-control" name="action" defaultValue={normalized.action} placeholder="Sign in, role change…" />
          </label>
          <label className="form-label">
            Result
            <select className="form-control" name="result" defaultValue={normalized.result}>
              <option value="">All results</option>
              <option value="success">Success</option>
              <option value="blocked">Blocked</option>
              <option value="failure">Failure</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="form-label">
              From
              <input className="form-control" name="from" type="date" defaultValue={normalized.from} />
            </label>
            <label className="form-label">
              To
              <input className="form-control" name="to" type="date" defaultValue={normalized.to} />
            </label>
          </div>
        </div>
        <div className="filter-actions">
          <ResultsSummary count={rows.length} noun="event" activeFilters={activeFilters} />
          <div className="flex items-center gap-2">
            {activeFilters ? <Link className="button button-secondary" href="/audit">Clear filters</Link> : null}
            <button className="button button-primary" type="submit">Apply filters</button>
          </div>
        </div>
      </form>

      {rows.length ? (
        <section className="table-shell" aria-labelledby="audit-results-heading">
          <div className="flex items-center justify-between border-b border-slate-300 px-4 py-3">
            <h2 id="audit-results-heading" className="section-title">Events</h2>
            <span className="text-xs text-slate-500">Newest first</span>
          </div>
          <div className="table-scroll max-h-[38rem]">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap">{formatDateTime(event.createdAt)}</td>
                    <td>
                      <span className="block font-medium text-slate-950">{event.actorName ?? 'System'}</span>
                      {event.actorEmail ? <span className="block text-xs text-slate-500">{event.actorEmail}</span> : null}
                    </td>
                    <td className="font-medium text-slate-900">{humanizeKey(event.action)}</td>
                    <td>
                      {humanizeKey(event.entityType)}
                      {event.entityId ? <span className="ml-1 font-mono text-xs text-slate-500">{event.entityId.slice(0, 8)}</span> : null}
                    </td>
                    <td><StatusBadge tone={resultTone(event.result)}>{humanizeKey(event.result)}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : !loadError ? (
        <EmptyState
          title={activeFilters ? 'No events match these filters' : 'No audit events yet'}
          description={activeFilters ? 'Clear one or more filters and try again.' : 'Authentication and account changes will appear here.'}
          action={activeFilters ? <Link className="button button-secondary" href="/audit">Clear filters</Link> : undefined}
        />
      ) : null}
    </AppShell>
  );
}
