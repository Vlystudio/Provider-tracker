import { AppShell } from '@/components/app-shell';
import { CoverageWatchForm } from '@/components/coverage-watch-form';
import { EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { requirePagePermission } from '@/server/authorization';
import { getResolvedDataMode } from '@/server/data-layer';
import { listCoverageReferenceOptions, listCoverageWatches } from '@/server/operational-service';

export default async function CoveragePage() {
  const principal = await requirePagePermission('coverage:read');
  const dataMode = getResolvedDataMode();
  let rows: Awaited<ReturnType<typeof listCoverageWatches>> = [];
  let options: Awaited<ReturnType<typeof listCoverageReferenceOptions>> = { specialties: [], diagnoses: [] };
  let statusMessage: string | null = null;
  try { [rows, options] = await Promise.all([listCoverageWatches(principal), listCoverageReferenceOptions(principal)]); }
  catch { statusMessage = 'Coverage watches could not be loaded.'; }
  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={statusMessage}>
      <PageHeader eyebrow="Oversight" title="Coverage watches" summary="Counts of accepting, recently verified providers near a ZIP code. These are network availability checks, not clinical recommendations." />
      {principal.role === 'admin' ? <CoverageWatchForm specialties={options.specialties} diagnoses={options.diagnoses} /> : null}
      {rows.length ? <section className="table-shell"><div className="table-scroll"><table className="data-table min-w-[60rem]"><thead><tr><th>Watch</th><th>Area</th><th>Rule</th><th>Last count</th><th>State</th><th>Last checked</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="font-semibold text-slate-950">{row.name}</span><span className="block text-xs text-slate-500">{row.specialtyName ?? row.diagnosisCode}</span></td><td>{row.postalCode} · {row.radiusMiles} miles</td><td>Below {row.minimumCount} · verified within {row.freshnessDays} days</td><td>{row.lastCount ?? 'Not checked'}</td><td><StatusBadge tone={row.state === 'alerting' ? 'danger' : row.state === 'healthy' ? 'positive' : 'neutral'}>{row.enabled ? row.state : 'Disabled'}</StatusBadge>{row.cycle ? <span className="ml-2 text-xs text-slate-500">Cycle {row.cycle}</span> : null}</td><td>{row.lastEvaluatedAt ? formatDateTime(row.lastEvaluatedAt) : 'Not checked'}</td></tr>)}</tbody></table></div></section> : !statusMessage ? <EmptyState title="No coverage watches" description={principal.role === 'admin' ? 'Add a watch above.' : 'An administrator has not added any watches.'} /> : null}
    </AppShell>
  );
}
