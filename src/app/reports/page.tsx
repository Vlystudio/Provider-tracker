import { AppShell } from '@/components/app-shell';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';

export default async function ReportsPage() {
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getReports();
  const metrics = state.data?.metrics ?? [];

  return (
    <AppShell dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <header className="card flex items-center justify-between p-5">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Analytics</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Reports</h1>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.length ? metrics.map((metric) => (
          <div key={metric.label} className="card p-4">
            <p className="text-sm text-slate-500">{metric.label}</p>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-3xl font-semibold text-slate-900">{metric.value}</span>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">{metric.change}</span>
            </div>
          </div>
        )) : (
          <div className="card p-4 md:col-span-2 xl:col-span-4">
            <p className="text-sm text-slate-500">No report metrics are available yet.</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
