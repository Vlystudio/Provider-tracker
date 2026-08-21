import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { EmptyState, PageHeader, ResultsSummary, StatusBadge, type StatusTone } from '@/components/ui';
import { formatDateTime, humanizeKey } from '@/lib/format';
import { requirePagePermission } from '@/server/authorization';
import { getResolvedDataMode } from '@/server/data-layer';
import { listOperationalChanges } from '@/server/operational-service';

type ChangeParams = { q?: string; type?: string; severity?: string; from?: string; to?: string; facility?: string };
function tone(value: string): StatusTone { return value === 'important' ? 'danger' : value === 'attention' ? 'warning' : 'info'; }
function valueLabel(value: Record<string, unknown> | null) {
  if (!value) return 'Not recorded';
  if ('value' in value) return value.value === null || value.value === undefined ? 'Not recorded' : humanizeKey(String(value.value));
  return Object.keys(value).map(humanizeKey).join(', ');
}

export default async function ChangesPage({ searchParams }: { searchParams?: Promise<ChangeParams> }) {
  const principal = await requirePagePermission('changes:read');
  const params: ChangeParams = await Promise.resolve(searchParams ?? {});
  const severity = ['informational', 'attention', 'important'].includes(params.severity ?? '') ? params.severity as 'informational' | 'attention' | 'important' : undefined;
  const dataMode = getResolvedDataMode();
  let rows: Awaited<ReturnType<typeof listOperationalChanges>> = [];
  let statusMessage: string | null = null;
  try { rows = await listOperationalChanges(principal, { query: params.q || undefined, eventType: params.type || undefined, severity, from: params.from || undefined, to: params.to ? `${params.to}T23:59:59.999Z` : undefined, facilityId: params.facility || undefined, limit: 100 }); }
  catch { statusMessage = 'Provider changes could not be loaded.'; }
  const activeFilters = [params.q, params.type, severity, params.from, params.to, params.facility].filter(Boolean).length;
  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={statusMessage}>
      <PageHeader eyebrow="Oversight" title="Provider changes" summary="Verified changes that passed the notification thresholds." />
      <form className="filter-bar" method="get" action="/changes" aria-label="Change filters"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><label className="form-label">Provider or city<input className="form-control" name="q" defaultValue={params.q} /></label><label className="form-label">Change type<input className="form-control" name="type" defaultValue={params.type} placeholder="Stopped accepting" /></label><label className="form-label">Severity<select className="form-control" name="severity" defaultValue={severity ?? ''}><option value="">Any severity</option><option value="informational">Informational</option><option value="attention">Attention</option><option value="important">Important</option></select></label><label className="form-label">From<input className="form-control" type="date" name="from" defaultValue={params.from} /></label><label className="form-label">To<input className="form-control" type="date" name="to" defaultValue={params.to} /></label></div><div className="filter-actions"><ResultsSummary count={rows.length} noun="change" activeFilters={activeFilters} /><div className="flex gap-2">{activeFilters ? <Link className="button button-secondary" href="/changes">Clear filters</Link> : null}<button className="button button-primary" type="submit">Apply filters</button></div></div></form>
      {rows.length ? <section className="table-shell"><div className="table-scroll"><table className="data-table min-w-[65rem]"><thead><tr><th>When</th><th>Provider</th><th>Change</th><th>Before</th><th>After</th><th>Severity</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="whitespace-nowrap">{formatDateTime(row.occurredAt)}</td><td>{row.facilityId ? <Link className="button-link" href={`/facilities/${row.facilityId}`}>{row.facilityName ?? 'Provider record'}</Link> : row.facilityName ?? 'Provider record'}<span className="block text-xs text-slate-500">{row.city}</span></td><td>{humanizeKey(row.eventType)}{row.specialtyName ? <span className="block text-xs text-slate-500">{row.specialtyName}</span> : null}{row.diagnosisCode ? <span className="block text-xs text-slate-500">{row.diagnosisCode}</span> : null}</td><td>{valueLabel(row.beforeValue)}</td><td>{valueLabel(row.afterValue)}</td><td><StatusBadge tone={tone(row.severity)}>{humanizeKey(row.severity)}</StatusBadge></td></tr>)}</tbody></table></div></section> : !statusMessage ? <EmptyState title="No changes found" description="Verified changes appear here after the change-detection job runs." /> : null}
    </AppShell>
  );
}
