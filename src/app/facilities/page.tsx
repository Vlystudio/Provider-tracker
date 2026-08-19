import { AppShell } from '@/components/app-shell';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';

export default async function FacilitiesPage() {
  const principal = await requirePagePermission('operations:read');
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const state = await adapter.getFacilities(principal);
  const rows = state.data ?? [];

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={!state.ok ? state.message : null}>
      <header className="card flex items-center justify-between p-5">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Master data</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Facilities</h1>
        </div>
      </header>

      <section className="card overflow-hidden">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Facility</th>
                  <th className="px-4 py-3">City</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Specialty</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((facility) => (
                  <tr key={facility.facilityId} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-medium text-slate-900">{facility.facilityName}</td>
                    <td className="px-4 py-3">{facility.city}</td>
                    <td className="px-4 py-3">{facility.facilityType}</td>
                    <td className="px-4 py-3">{facility.specialty}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{facility.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5 text-sm text-slate-500">No facility records are available yet.</div>
        )}
      </section>
    </AppShell>
  );
}
