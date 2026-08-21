import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { WorkItemActions } from '@/components/work-item-actions';
import { EmptyState, PageHeader, ResultsSummary, StatusBadge, type StatusTone } from '@/components/ui';
import { formatDateTime, humanizeKey } from '@/lib/format';
import { requirePagePermission } from '@/server/authorization';
import { getResolvedDataMode } from '@/server/data-layer';
import { listOperationalWork } from '@/server/operational-service';

type WorkParams = { type?: string; status?: string; assigned?: string };

function priorityTone(priority: string): StatusTone {
  if (priority === 'important') return 'danger';
  if (priority === 'attention') return 'warning';
  return 'info';
}

export default async function WorkPage({ searchParams }: { searchParams?: Promise<WorkParams> }) {
  const principal = await requirePagePermission('work:read');
  const params: WorkParams = await Promise.resolve(searchParams ?? {});
  const statusValues = ['open', 'assigned', 'in_progress', 'completed', 'dismissed', 'blocked'] as const;
  const status = statusValues.find((value) => value === params.status);
  const assignmentValues = ['mine', 'unassigned', 'all'] as const;
  const assigned = assignmentValues.find((value) => value === params.assigned) ?? (principal.role === 'admin' ? 'all' : 'mine');
  const dataMode = getResolvedDataMode();
  let rows: Awaited<ReturnType<typeof listOperationalWork>> = [];
  let statusMessage: string | null = null;

  try {
    rows = await listOperationalWork(principal, { status, workType: params.type || undefined, assigned, limit: 100 });
  } catch {
    statusMessage = 'Work items could not be loaded.';
  }

  const defaultAssignment = principal.role === 'admin' ? 'all' : 'mine';
  const activeFilters = [params.type, status, assigned !== defaultAssignment ? assigned : null].filter(Boolean).length;

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={statusMessage}>
      <PageHeader eyebrow="Operations" title="Work inbox" summary="Reverification, follow-up, data quality, and duplicate review in one list." />

      <form className="filter-bar" method="get" action="/work" aria-label="Work filters">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="form-label">Work type
            <select className="form-control" name="type" defaultValue={params.type ?? ''}>
              <option value="">All types</option><option value="reverification">Reverification</option><option value="follow_up">Follow-up</option><option value="data_quality">Data quality</option><option value="duplicate_review">Duplicate review</option>
            </select>
          </label>
          <label className="form-label">Status
            <select className="form-control" name="status" defaultValue={status ?? ''}>
              <option value="">Active</option><option value="open">Open</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option><option value="dismissed">Dismissed</option>
            </select>
          </label>
          <label className="form-label">Assignment
            <select className="form-control" name="assigned" defaultValue={assigned}>
              <option value="mine">Mine</option>
              {principal.role === 'admin' ? <><option value="unassigned">Unassigned</option><option value="all">All</option></> : null}
            </select>
          </label>
        </div>
        <div className="filter-actions">
          <ResultsSummary count={rows.length} noun="item" activeFilters={activeFilters} />
          <div className="flex gap-2">{activeFilters ? <Link className="button button-secondary" href="/work">Clear filters</Link> : null}<button className="button button-primary" type="submit">Apply filters</button></div>
        </div>
      </form>

      {rows.length ? (
        <section className="table-shell" aria-labelledby="work-heading">
          <h2 id="work-heading" className="sr-only">Work items</h2>
          <div className="table-scroll">
            <table className="data-table min-w-[70rem]">
              <thead><tr><th>Item</th><th>Priority</th><th>Reason</th><th>Due</th><th>Assigned to</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{rows.map((item) => (
                <tr key={item.id}>
                  <td><span className="font-semibold text-slate-950">{item.facilityName ?? humanizeKey(item.targetType)}</span><span className="block text-xs text-slate-500">{item.facilityCity ?? humanizeKey(item.workType)}</span></td>
                  <td><StatusBadge tone={priorityTone(item.priority)}>{humanizeKey(item.priority)}</StatusBadge></td>
                  <td>{item.reasonCodes.map(humanizeKey).join(', ')}</td>
                  <td>{item.dueAt ? formatDateTime(item.dueAt) : 'No due date'}</td>
                  <td>{item.assignedName ?? 'Unassigned'}</td>
                  <td><StatusBadge tone={item.status === 'blocked' ? 'warning' : item.status === 'completed' ? 'positive' : 'neutral'}>{humanizeKey(item.status)}</StatusBadge></td>
                  <td className="text-right">
                    {item.targetType === 'facility' ? <Link className="button-link mr-3" href={`/facilities/${item.targetId}`}>Open provider</Link> : null}
                    {item.targetType === 'duplicate_candidate' ? <Link className="button-link mr-3" href="/duplicates">Open review</Link> : null}
                    {(principal.role === 'admin' || item.assignedTo === principal.id) && !['completed', 'dismissed'].includes(item.status) ? <WorkItemActions id={item.id} status={item.status} expectedVersion={item.optimisticLockVersion} /> : null}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ) : !statusMessage ? <EmptyState title="No work here" description="Change the filters or check back after the next scheduled scan." /> : null}
    </AppShell>
  );
}
