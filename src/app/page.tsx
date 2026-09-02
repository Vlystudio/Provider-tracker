import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { DashboardViewToggle } from '@/components/dashboard-view-toggle';
import { EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { formatDateTime, humanizeKey } from '@/lib/format';
import { requirePagePermission } from '@/server/authorization';
import { listAuditEvents } from '@/server/audit-log';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { getUiPreferences } from '@/server/ui-preferences';

function reportRange(dataMode: 'database' | 'demo') {
  if (dataMode === 'demo') return { from: '2026-05-01', to: '2026-05-31' };
  const now = new Date();
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
  };
}

export default async function HomePage() {
  const principal = await requirePagePermission('app:access');
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();

  if (principal.role === 'report_viewer') {
    const state = await adapter.getReports(principal, reportRange(dataMode));
    const report = state.data;
    return (
      <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
        <PageHeader eyebrow="Workspace" title="Reporting" summary="Open the report workspace to answer call-volume and outcome questions." />
        {report?.total ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Current report summary">
            {report.metrics.map((metric) => (
              <div key={metric.label} className="panel p-4">
                <p className="text-sm font-medium text-slate-700">{metric.label}</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{metric.value}</p>
                <p className="mt-2 text-xs text-slate-500">{metric.detail}</p>
              </div>
            ))}
          </section>
        ) : (
          <EmptyState title="No report data this month" description="Choose another period in Reports." />
        )}
        <div><Link className="button button-primary" href="/reports">Open reports</Link></div>
      </AppShell>
    );
  }

  if (principal.role === 'auditor') {
    let events: Awaited<ReturnType<typeof listAuditEvents>>['rows'] = [];
    let loadError: string | null = null;
    try {
      ({ rows: events } = await listAuditEvents(principal, {}));
    } catch {
      loadError = 'Audit events could not be loaded. Try again or ask IT to check the database service.';
    }
    return (
      <AppShell user={principal} dataMode={dataMode} statusMessage={loadError}>
        <PageHeader eyebrow="Workspace" title="Audit review" summary="Review recent security and record-change events, then filter the full audit log when needed." />
        {events.length ? (
          <section className="table-shell" aria-labelledby="recent-audit-heading">
            <div className="flex items-center justify-between border-b border-slate-300 px-4 py-3">
              <h2 id="recent-audit-heading" className="section-title">Recent events</h2>
              <Link className="button-link" href="/audit">View all</Link>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Result</th></tr></thead>
                <tbody>
                  {events.slice(0, 8).map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap">{formatDateTime(event.createdAt)}</td>
                      <td>{event.actorName ?? 'System'}</td>
                      <td>{humanizeKey(event.action)}</td>
                      <td><StatusBadge tone={event.result === 'success' ? 'positive' : event.result === 'blocked' ? 'warning' : 'danger'}>{humanizeKey(event.result)}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : !loadError ? (
          <EmptyState title="No audit events yet" description="Authentication and account changes will appear here." />
        ) : null}
        <div className="flex gap-2">
          <Link className="button button-primary" href="/audit">Open audit log</Link>
          <Link className="button button-secondary" href="/reports">Open reports</Link>
        </div>
      </AppShell>
    );
  }

  const [state, preferences] = await Promise.all([
    adapter.getDashboard(principal),
    getUiPreferences(),
  ]);
  const statCards = state.data?.cards ?? [];
  const reliability = state.data?.reliability;
  const actions = principal.role === 'admin'
    ? [
        { label: 'Open work inbox', href: '/work' },
        { label: 'Manage automation', href: '/automation' },
        { label: 'Manage staff accounts', href: '/admin' },
        { label: 'Review audit log', href: '/audit' },
        { label: 'Search providers', href: '/provider-search' },
      ]
    : [
        { label: 'Open work inbox', href: '/work' },
        { label: 'Open tracking records', href: '/tracking-records' },
        { label: 'Search providers', href: '/provider-search' },
        { label: 'Open review queue', href: '/review-queue' },
      ];

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <PageHeader
        eyebrow="Workspace"
        title={principal.role === 'admin' ? 'Operations overview' : 'My work'}
        summary={principal.role === 'admin' ? 'Provider activity, follow-up, and system access for the current week.' : 'Provider calls and follow-up assigned to your workspace.'}
        meta={<div className="flex items-center gap-3"><span className="hidden sm:inline">Current week</span><DashboardViewToggle initialMode={preferences.dashboardMode} /></div>}
      />

      {statCards.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Current week summary">
          {statCards.map((card) => (
            <div key={card.label} className="panel p-4">
              <p className="text-sm text-slate-600">{card.label}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{card.value}</p>
            </div>
          ))}
        </section>
      ) : null}

      {preferences.dashboardMode === 'detailed' && reliability ? (
        <section className="grid gap-4 md:grid-cols-2" aria-label="Operational attention">
          <Link href="/work" className="panel block p-4 hover:border-slate-500">
            <p className="text-sm font-medium text-slate-700">{principal.role === 'admin' ? 'Active work' : 'My active work'}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{reliability.activeWork}</p>
            <p className="mt-2 text-sm text-slate-600">Open the work inbox</p>
          </Link>
          <Link href="/changes?severity=important" className="panel block p-4 hover:border-slate-500">
            <p className="text-sm font-medium text-slate-700">Recent important changes</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{reliability.importantChanges}</p>
            <p className="mt-2 text-sm text-slate-600">Open the change feed</p>
          </Link>
        </section>
      ) : null}

      {preferences.dashboardMode === 'detailed' && reliability ? (
        <section className="panel p-5" aria-labelledby="reliability-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="reliability-heading" className="section-title">Availability reliability</h2>
              <p className="mt-1 text-sm text-slate-600">Unknown availability is reviewed every 30 days. Confirmed future booking dates remain excluded until their review date.</p>
            </div>
            <Link className="button-link" href="/review-queue">Open review queue</Link>
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-sm text-slate-600">Active facilities</dt><dd className="mt-1 text-2xl font-semibold text-slate-950">{reliability.activeFacilities}</dd></div>
            <div><dt className="text-sm text-slate-600">Confirmed unavailable</dt><dd className="mt-1 text-2xl font-semibold text-slate-950">{reliability.confirmedUnavailable}</dd></div>
            <div><dt className="text-sm text-slate-600">Availability not confirmed</dt><dd className="mt-1 text-2xl font-semibold text-slate-950">{reliability.unconfirmedAvailability}</dd></div>
            <div><dt className="text-sm text-slate-600">Checks due now</dt><dd className="mt-1 text-2xl font-semibold text-slate-950">{reliability.availabilityDue}</dd></div>
          </dl>
        </section>
      ) : null}

      <section className="panel p-5" aria-labelledby="quick-actions-heading">
        <h2 id="quick-actions-heading" className="section-title">Quick actions</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {actions.map((action, index) => (
            <Link key={action.href} href={action.href} className={`button ${index === 0 ? 'button-primary' : 'button-secondary'}`}>{action.label}</Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
