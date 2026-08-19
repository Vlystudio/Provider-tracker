import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

export default async function HomePage() {
  const principal = await requirePagePermission('app:access');
  const adapter = getAppDataAdapter();
  const state = await adapter.getDashboard(principal);
  const dataMode = getResolvedDataMode();
  const statCards = state.data?.cards ?? [];
  const recentAuthorizations = state.data?.recentAuthorizations ?? [];
  const reviewPreview = state.data?.reviewPreview ?? [];

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <header className="flex flex-col gap-2 border-b border-slate-300 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">Provider calls and follow-up for the current week.</p>
        </div>
        <p className="text-sm font-medium text-slate-600">Current week</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.length ? statCards.map((card) => (
          <div key={card.label} className="card p-4">
            <p className="text-sm text-slate-600">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{card.value}</p>
          </div>
        )) : (
          <div className="card p-4 md:col-span-2 xl:col-span-4">
            <p className="text-sm text-slate-600">Metrics will appear after the database is connected.</p>
          </div>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Quick actions</h2>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Start authorization', href: '/authorization-summary' },
              { label: 'Find a provider', href: '/provider-search' },
              { label: 'Open review queue', href: '/review-queue' },
            ].map((action) => (
              <Link key={action.label} href={action.href} className="rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:border-slate-500 hover:bg-slate-50">
                {action.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-lg font-semibold text-slate-900">My recent authorizations</h2>
          <div className="mt-4 space-y-3">
            {recentAuthorizations.length ? recentAuthorizations.map((item) => (
              <div key={item.number} className="flex items-center justify-between border-b border-slate-200 pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="font-medium text-slate-900">{item.number}</p>
                  <p className="text-sm text-slate-500">{item.lob} · {item.owner}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  {item.status}
                </span>
              </div>
            )) : (
              <p className="text-sm text-slate-600">No recent authorizations.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-slate-900">Provider search</h2>
          <form method="get" action="/provider-search" className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
            <label className="text-sm text-slate-600">
              Member ZIP
              <input name="memberZip" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2" defaultValue="04530" />
            </label>
            <label className="text-sm text-slate-600">
              Radius
              <select name="radius" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2" defaultValue="50">
                <option value={25}>25 miles</option>
                <option value={50}>50 miles</option>
                <option value={100}>100 miles</option>
                <option value={150}>150 miles</option>
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Diagnosis
              <input name="diagnosis" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2" defaultValue="J45" />
            </label>
            <button type="submit" className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
              Search
            </button>
          </form>
        </div>

        <div className="card p-5">
          <h2 className="text-lg font-semibold text-slate-900">Review queue</h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {reviewPreview.length ? reviewPreview.map((item) => (
              <li key={item.caseId} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2">
                <span>{item.facility}</span>
                <span className={`rounded-full px-2 py-1 text-xs ${
                  item.priority === 'warning' ? 'bg-amber-100 text-amber-800' : item.priority === 'danger' ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-800'
                }`}>{item.due}</span>
              </li>
            )) : (
              <li className="text-sm text-slate-600">Nothing is due for review.</li>
            )}
          </ul>
        </div>
      </section>
    </AppShell>
  );
}
