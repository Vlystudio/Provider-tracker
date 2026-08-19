import { AppShell } from '@/components/app-shell';
import { getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

export default async function NewCallPage() {
  const principal = await requirePagePermission('operations:write');
  const dataMode = getResolvedDataMode();

  return (
    <AppShell user={principal} dataMode={dataMode}>
      <header className="card flex items-center justify-between p-5">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Workflow</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">New Call</h1>
        </div>
      </header>

      <section className="card p-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Call capture is not enabled in this environment until the app is connected to PostgreSQL and the authenticated write flow is active.
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-600">
            Authorization number
            <input disabled className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-500" defaultValue="A-10482" />
          </label>
          <label className="text-sm text-slate-600">
            Facility
            <input disabled className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-500" defaultValue="Brunswick Clinic" />
          </label>
          <label className="text-sm text-slate-600">
            Specialty
            <input disabled className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-500" defaultValue="Pulmonology" />
          </label>
          <label className="text-sm text-slate-600">
            Diagnosis
            <input disabled className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-500" defaultValue="J45" />
          </label>
          <label className="text-sm text-slate-600 md:col-span-2">
            Notes
            <textarea disabled className="mt-1 min-h-28 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-500" defaultValue="Accepted new patients, can treat diagnosis, scheduling within four weeks. Follow-up with urgent referral if needed." />
          </label>
        </div>

        <div className="mt-6 flex gap-3">
          <button disabled className="rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 cursor-not-allowed">Save call</button>
          <button disabled className="rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500 cursor-not-allowed">Mark as review</button>
        </div>
      </section>
    </AppShell>
  );
}
