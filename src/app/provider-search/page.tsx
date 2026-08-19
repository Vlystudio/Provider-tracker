import { AppShell } from '@/components/app-shell';
import { providerSearchValidation } from '@/lib/domain';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

export default async function ProviderSearchPage({
  searchParams,
}: {
  searchParams?: Promise<{ memberZip?: string; radius?: string; diagnosis?: string; specialty?: string }> | { memberZip?: string; radius?: string; diagnosis?: string; specialty?: string };
}) {
  const principal = await requirePagePermission('operations:read');
  const params = (await Promise.resolve(searchParams ?? {})) as {
    memberZip?: string;
    radius?: string;
    diagnosis?: string;
    specialty?: string;
  };

  const memberZip = params.memberZip?.trim() || '04530';
  const radius = Number(params.radius ?? '50');
  const diagnosis = params.diagnosis?.trim() || 'J45';
  const specialty = params.specialty?.trim() || '';
  const validation = providerSearchValidation({
    memberZip,
    radius,
    diagnosis: diagnosis || undefined,
    specialty: specialty || undefined,
  });

  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getProviderSearch(principal, {
    memberZip,
    radius,
    diagnosis: validation.success ? diagnosis : undefined,
    specialty: validation.success ? specialty : undefined,
    page: 1,
    pageSize: 10,
  });
  const results = state.data ?? [];

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <header className="card flex items-center justify-between p-5">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Search</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Provider Search</h1>
        </div>
      </header>

      <section className="card p-5">
        <form method="get" action="/provider-search" className="grid gap-4 md:grid-cols-4">
          <label className="text-sm text-slate-600">
            Member ZIP
            <input name="memberZip" defaultValue={memberZip} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-600">
            Radius
            <select name="radius" defaultValue={radius} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <option value={25}>25 miles</option>
              <option value={50}>50 miles</option>
              <option value={100}>100 miles</option>
              <option value={150}>150 miles</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            Diagnosis
            <input name="diagnosis" defaultValue={diagnosis} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-600">
            Specialty
            <input name="specialty" defaultValue={specialty} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" placeholder="Optional" />
          </label>
          <div className="md:col-span-4 flex justify-end">
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Search providers</button>
          </div>
        </form>

        {!validation.success ? (
          <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{validation.error}</p>
        ) : null}
      </section>

      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Search results</h2>
          <span className="text-sm text-slate-500">{results.length} providers</span>
        </div>

        <div className="space-y-3">
          {results.length ? results.map((result) => (
            <div key={result.facilityId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-lg font-semibold text-slate-900">{result.facilityName}</p>
                  <p className="text-sm text-slate-500">{result.city} · {result.specialty}</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">{result.latestAcceptingStatus}</span>
              </div>
              <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-4">
                <span>Distance: {result.distanceMiles} mi</span>
                <span>Phone: {result.phone}</span>
                <span>Outcome: {result.recommendation}</span>
                <span>Next step: {result.recommendation}</span>
              </div>
            </div>
          )) : (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              {!validation.success ? 'Fix the validation issue to continue.' : 'No providers match the search criteria.'}
            </p>
          )}
        </div>
      </section>
    </AppShell>
  );
}
