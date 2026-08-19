import { AppShell } from '@/components/app-shell';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

export default async function CallLogPage() {
  const principal = await requirePagePermission('operations:read');
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getCallLog(principal);
  const rows = state.data ?? [];

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <header className="card flex items-center justify-between p-5">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Operations</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Call Log</h1>
        </div>
      </header>

      <section className="card overflow-hidden">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Authorization</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((call) => (
                  <tr key={`${call.number}-${call.provider}`} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-medium text-slate-900">{call.number}</td>
                    <td className="px-4 py-3">{call.provider}</td>
                    <td className="px-4 py-3">{call.outcome}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{call.status}</span>
                    </td>
                    <td className="px-4 py-3">{call.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5 text-sm text-slate-500">No call log entries are available yet.</div>
        )}
      </section>
    </AppShell>
  );
}
