import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { EmptyState, InlineMessage, PageHeader, StatusBadge } from '@/components/ui';
import { formatDate, formatDateTime, humanizeKey } from '@/lib/format';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

type ReportSearchParams = { from?: string; to?: string; drilldown?: string };
const drilldownValues = ['fresh', 'accepting', 'newly_accepting', 'became_unavailable', 'stale'] as const;

function currentMonthRange() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return { from: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10) };
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
  const drilldown = drilldownValues.find((item) => item === params.drilldown);
  const state = await adapter.getReports(principal, { ...range, drilldown });
  const report = state.data;
  const metrics = report?.metrics ?? [];
  const hasFilteredPeriod = range.from !== defaults.from || range.to !== defaults.to;

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <PageHeader eyebrow="Oversight" title="Provider reports" summary="Verification, contact, availability, and specialty coverage from recorded history." meta={`${formatDate(range.from)} – ${formatDate(range.to)}`} />
      {!validRange ? <InlineMessage tone="error" role="alert">The start date must be on or before the end date. The default period is shown below.</InlineMessage> : null}
      <form className="filter-bar" method="get" action="/reports" aria-label="Report period"><div className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl"><label className="form-label">Start date<input className="form-control" name="from" type="date" defaultValue={range.from} required /></label><label className="form-label">End date<input className="form-control" name="to" type="date" defaultValue={range.to} required /></label></div><div className="filter-actions"><p className="text-sm text-slate-600">Source: {dataMode === 'demo' ? 'local demo records' : 'operational history'}</p><div className="flex gap-2">{hasFilteredPeriod || drilldown ? <Link className="button button-secondary" href="/reports">Reset</Link> : null}<button className="button button-primary" type="submit">Run report</button></div></div></form>

      {metrics.length ? <section aria-labelledby="report-results-heading"><div className="mb-3"><h2 id="report-results-heading" className="section-title">Summary</h2><p className="mt-1 text-xs text-slate-500">Generated {formatDateTime(report!.generatedAt)}. Every percentage shows its denominator.</p></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => {
        const content = <><p className="text-sm font-medium text-slate-700">{metric.label}</p><p className="mt-2 text-3xl font-semibold text-slate-950">{metric.value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{metric.detail}</p></>;
        return metric.href ? <Link key={metric.label} className="panel p-4 hover:border-slate-500" href={metric.href}>{content}</Link> : <div key={metric.label} className="panel p-4">{content}</div>;
      })}</div></section> : state.ok ? <EmptyState title="No report data" description="Choose a wider date range." /> : null}

      {report?.trend.length ? <section className="table-shell" aria-labelledby="trend-heading"><div className="border-b border-slate-300 px-4 py-3"><h2 id="trend-heading" className="section-title">Daily activity</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">Date</th><th scope="col">Verifications</th><th scope="col">Successful phone verifications</th><th scope="col">Failed contacts</th></tr></thead><tbody>{report.trend.map((row) => <tr key={row.date}><td>{formatDate(row.date)}</td><td>{row.verifications}</td><td>{row.successfulContacts}</td><td>{row.failedContacts}</td></tr>)}</tbody></table></div></section> : null}

      {report?.coverage.length ? <section className="table-shell" aria-labelledby="coverage-heading"><div className="border-b border-slate-300 px-4 py-3"><h2 id="coverage-heading" className="section-title">Specialty coverage</h2><p className="mt-1 text-xs text-slate-500">Facility availability only. This is not clinical guidance.</p></div><div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">Specialty</th><th scope="col">Active facilities</th><th scope="col">Specialty verified</th><th scope="col">Currently accepting</th></tr></thead><tbody>{report.coverage.map((row) => <tr key={row.specialty}><td className="font-medium">{row.specialty}</td><td>{row.facilities}</td><td>{row.fresh} of {row.facilities}</td><td>{row.accepting} of {row.facilities}</td></tr>)}</tbody></table></div></section> : null}

      {drilldown ? <section className="table-shell" aria-labelledby="drilldown-heading"><div className="flex items-center justify-between border-b border-slate-300 px-4 py-3"><h2 id="drilldown-heading" className="section-title">{humanizeKey(drilldown)}</h2><span className="text-sm text-slate-600">{report?.drilldown.length ?? 0} records</span></div>{report?.drilldown.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">Facility</th><th scope="col">City</th><th scope="col">Accepting</th><th scope="col">Last verified</th></tr></thead><tbody>{report.drilldown.map((row) => <tr key={row.facilityId}><td>{dataMode === 'database' ? <Link className="font-semibold text-slate-950 underline-offset-2 hover:underline" href={`/facilities/${row.facilityId}`}>{row.facilityName}</Link> : <span className="font-semibold text-slate-950">{row.facilityName}</span>}</td><td>{row.city}</td><td><StatusBadge tone={row.acceptingStatus === 'yes' ? 'positive' : row.acceptingStatus === 'no' ? 'danger' : 'neutral'}>{humanizeKey(row.acceptingStatus)}</StatusBadge></td><td>{row.lastVerifiedAt ? formatDate(row.lastVerifiedAt) : 'Never'}</td></tr>)}</tbody></table></div> : <div className="p-4 text-sm text-slate-600">No records are behind this metric for the selected period.</div>}</section> : null}
    </AppShell>
  );
}
