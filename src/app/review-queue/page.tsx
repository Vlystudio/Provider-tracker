import { AppShell } from '@/components/app-shell';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';

export default async function ReviewQueuePage() {
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getReviewQueue();
  const items = state.data ?? [];

  return (
    <AppShell dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <header className="card flex items-center justify-between p-5">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Follow-up</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Review Queue</h1>
        </div>
      </header>

      <section className="card p-5">
        {items.length ? (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.caseId} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="font-semibold text-slate-900">{item.facility}</p>
                  <p className="text-sm text-slate-500">{item.caseId} · owner {item.owner}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    item.priority === 'warning' ? 'bg-amber-100 text-amber-800' :
                    item.priority === 'danger' ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-800'
                  }`}>{item.due}</span>
                  <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">Open</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No review records are queued right now.</p>
        )}
      </section>
    </AppShell>
  );
}
