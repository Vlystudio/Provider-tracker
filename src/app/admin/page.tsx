import { AppShell } from '@/components/app-shell';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';

export default async function AdminPage() {
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getAdminOverview();
  const tasks = state.data?.tasks ?? [];
  const batches = state.data?.importBatches ?? [];

  return (
    <AppShell dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <header className="card flex items-center justify-between p-5">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Configuration</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Admin</h1>
        </div>
      </header>

      <section className="card p-5">
        <h2 className="text-lg font-semibold text-slate-900">Admin tasks</h2>
        {tasks.length ? (
          <div className="mt-4 space-y-3">
            {tasks.map((task) => (
              <div key={task.title} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="font-semibold text-slate-900">{task.title}</p>
                  <p className="text-sm text-slate-500">{task.detail}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{task.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No admin tasks are pending.</p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold text-slate-900">Import batches</h2>
        {batches.length ? (
          <div className="mt-4 space-y-3">
            {batches.map((batch) => (
              <div key={batch.batchId} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-900">{batch.fileName}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{batch.status}</span>
                </div>
                <div className="mt-2 flex gap-4 text-xs uppercase tracking-[0.08em] text-slate-500">
                  <span>{batch.rows} rows</span>
                  <span>{batch.rejected} rejected</span>
                  <span>{batch.issues} issues</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No import batches are available yet.</p>
        )}
      </section>
    </AppShell>
  );
}
