import { AppShell } from '@/components/app-shell';
import { getResolvedDataMode } from '@/server/data-layer';

export default function AuthorizationSummaryPage() {
  const dataMode = getResolvedDataMode();

  return (
    <AppShell dataMode={dataMode}>
      <header className="card flex items-center justify-between p-5">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Case summary</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Authorization Summary</h1>
        </div>
      </header>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-slate-900">A-10482</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <p><span className="font-medium text-slate-900">LOB:</span> GA</p>
            <p><span className="font-medium text-slate-900">Referral reason:</span> Network issue requiring out-of-network access</p>
            <p><span className="font-medium text-slate-900">Diagnosis:</span> J45 - Asthma</p>
            <p><span className="font-medium text-slate-900">Specialty:</span> Pulmonology</p>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-lg font-semibold text-slate-900">Provider results</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-700">
            <li className="rounded-lg bg-slate-50 p-3"><span className="font-medium text-slate-900">Brunswick Clinic:</span> meets availability guidelines</li>
            <li className="rounded-lg bg-slate-50 p-3"><span className="font-medium text-slate-900">Midcoast Center:</span> unable to contact</li>
            <li className="rounded-lg bg-slate-50 p-3"><span className="font-medium text-slate-900">Topsham Specialty:</span> does not meet availability guidelines</li>
          </ul>
        </div>
      </section>
    </AppShell>
  );
}
