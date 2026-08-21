import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { EmptyState, InlineMessage, PageHeader } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

type ReportSearchParams = { from?: string; to?: string };

function currentMonthRange() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const from = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function isDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).valueOf());
}

export default async function ReportsPage({ searchParams }: { searchParams?: Promise<ReportSearchParams> }) {
  const principal = await requirePagePermission('reports:read');
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const defaults = dataMode === 'demo' ? { from: '2026-05-01', to: '2026-05-31' } : currentMonthRange();
  const params: ReportSearchParams = await Promise.resolve(searchParams ?? {});
  const rawFrom = params.from || defaults.from;
  const rawTo = params.to || defaults.to;
  const validRange = isDateInput(rawFrom) && isDateInput(rawTo) && rawFrom <= rawTo;
  const range = validRange ? { from: rawFrom, to: rawTo } : defaults;
  const state = await adapter.getReports(principal, range);
  const report = state.data;
  const metrics = report?.metrics ?? [];
  const hasFilteredPeriod = range.from !== defaults.from || range.to !== defaults.to;

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <PageHeader
        eyebrow="Oversight"
        title="Reports"
        summary="Call outcomes for the selected period. Counts use completed call records in the connected data source."
        meta={`${formatDate(range.from)} – ${formatDate(range.to)}`}
      />

      {!validRange ? (
        <InlineMessage tone="error" role="alert">The start date must be on or before the end date. The default period is shown below.</InlineMessage>
      ) : null}

      <form className="filter-bar" method="get" action="/reports" aria-label="Report period">
        <div className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
          <label className="form-label">
            Start date
            <input className="form-control" name="from" type="date" defaultValue={range.from} required />
          </label>
          <label className="form-label">
            End date
            <input className="form-control" name="to" type="date" defaultValue={range.to} required />
          </label>
        </div>
        <div className="filter-actions">
          <p className="text-sm text-slate-600">Source: {dataMode === 'demo' ? 'local demo records' : 'operational database'}</p>
          <div className="flex gap-2">
            {hasFilteredPeriod ? <Link className="button button-secondary" href="/reports">Reset period</Link> : null}
            <button className="button button-primary" type="submit">Run report</button>
          </div>
        </div>
      </form>

      {report?.total ? (
        <section aria-labelledby="report-results-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="report-results-heading" className="section-title">Outcome summary</h2>
              <p className="mt-1 text-xs text-slate-500">Generated {formatDateTime(report.generatedAt)}</p>
            </div>
            <p className="text-sm font-medium text-slate-700">{report.total} total {report.total === 1 ? 'call' : 'calls'}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="panel p-4">
                <p className="text-sm font-medium text-slate-700">{metric.label}</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{metric.value}</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">{metric.detail}</p>
              </div>
            ))}
          </div>
        </section>
      ) : state.ok ? (
        <EmptyState
          title="No calls in this period"
          description="Choose a wider date range or reset the report period."
          action={hasFilteredPeriod ? <Link className="button button-secondary" href="/reports">Reset period</Link> : undefined}
        />
      ) : null}
    </AppShell>
  );
}
