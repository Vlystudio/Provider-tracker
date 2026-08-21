import { AppShell } from '@/components/app-shell';
import { AutomationControls } from '@/components/automation-controls';
import { PageHeader, StatusBadge } from '@/components/ui';
import { formatDateTime, humanizeKey } from '@/lib/format';
import { addLocalDays, formatLocalDate, zonedDateTimeToUtc } from '@/lib/automation-time';
import { getAutomationSettings, defaultAutomationSettings } from '@/server/automation-config';
import { requirePagePermission } from '@/server/authorization';
import { getResolvedDataMode } from '@/server/data-layer';
import { getAutomationHealth } from '@/server/operational-service';

export default async function AutomationPage() {
  const principal = await requirePagePermission('automation:read');
  const dataMode = getResolvedDataMode();
  let health: Awaited<ReturnType<typeof getAutomationHealth>> = { latest: [], recent: [], openWork: 0, overdueWork: 0, activeCoverageAlerts: 0, failuresLastSevenDays: 0 };
  let settings = defaultAutomationSettings;
  let statusMessage: string | null = null;
  try { [health, settings] = await Promise.all([getAutomationHealth(principal), getAutomationSettings()]); }
  catch { statusMessage = 'Automation status could not be loaded.'; }
  const now = new Date();
  const today = formatLocalDate(now, settings.timeZone);
  let nextDaily = zonedDateTimeToUtc(today, settings.dailyDigestHour, settings.timeZone);
  if (nextDaily <= now) nextDaily = zonedDateTimeToUtc(addLocalDays(today, 1), settings.dailyDigestHour, settings.timeZone);
  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={statusMessage}>
      <PageHeader eyebrow="System" title="Automation" summary="Job history, work backlog, and the rules used by scheduled scans." meta={`Next expected daily trigger: ${formatDateTime(nextDaily)}`} />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Automation summary"><div className="panel p-4"><p className="text-sm text-slate-600">Open work</p><p className="mt-2 text-3xl font-semibold text-slate-950">{health.openWork}</p></div><div className="panel p-4"><p className="text-sm text-slate-600">Overdue work</p><p className="mt-2 text-3xl font-semibold text-slate-950">{health.overdueWork}</p></div><div className="panel p-4"><p className="text-sm text-slate-600">Coverage alerts</p><p className="mt-2 text-3xl font-semibold text-slate-950">{health.activeCoverageAlerts}</p></div><div className="panel p-4"><p className="text-sm text-slate-600">Failed jobs · 7 days</p><p className="mt-2 text-3xl font-semibold text-slate-950">{health.failuresLastSevenDays}</p></div></section>
      <AutomationControls initialSettings={settings} />
      <section className="table-shell" aria-labelledby="job-history-heading"><div className="border-b border-slate-300 px-4 py-3"><h2 id="job-history-heading" className="section-title">Recent job history</h2></div><div className="table-scroll"><table className="data-table min-w-[68rem]"><thead><tr><th>Started</th><th>Job</th><th>Trigger</th><th>Result</th><th>Checked</th><th>Created</th><th>Errors</th><th>Retries</th><th>Release</th></tr></thead><tbody>{health.recent.map((row) => <tr key={row.id}><td>{formatDateTime(row.startedAt)}</td><td>{humanizeKey(row.jobType)}</td><td>{humanizeKey(row.trigger)}</td><td><StatusBadge tone={row.result === 'succeeded' || row.result === 'dry_run' ? 'positive' : row.result === 'failed' ? 'danger' : 'neutral'}>{humanizeKey(row.result)}</StatusBadge></td><td>{row.processedCount}</td><td>{row.createdCount}</td><td>{row.errorCount}</td><td>{row.retryCount}</td><td>{row.releaseVersion}</td></tr>)}</tbody></table></div>{!health.recent.length ? <p className="p-5 text-sm text-slate-600">No jobs have run yet.</p> : null}</section>
    </AppShell>
  );
}
