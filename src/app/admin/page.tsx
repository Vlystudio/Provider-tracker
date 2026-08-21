import { AppShell } from '@/components/app-shell';
import { EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { UserManagement, type ManagedUser } from '@/components/user-management';
import { getAppDataAdapter, getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';
import { listUsersForAdministrator } from '@/server/user-administration';

export default async function AdminPage() {
  const principal = await requirePagePermission('admin:read');
  const adapter = getAppDataAdapter();
  const dataMode = getResolvedDataMode();
  const overview = await adapter.getAdminOverview(principal);
  let users: ManagedUser[] = [];
  let userLoadError: string | null = null;

  try {
    const records = await listUsersForAdministrator(principal);
    users = records.map((user) => ({
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    }));
  } catch {
    userLoadError = 'Staff accounts could not be loaded. Try again or ask IT to check the database service.';
  }

  const tasks = overview.data?.tasks ?? [];
  const batches = overview.data?.importBatches ?? [];
  const statusMessage = userLoadError ?? (!overview.ok ? overview.message : null);

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={statusMessage}>
      <PageHeader
        eyebrow="System"
        title="Administration"
        summary="Manage staff access and review data-loading status. Account changes take effect immediately."
      />

      {userLoadError ? null : <UserManagement initialUsers={users} currentUserId={principal.id} />}

      <section className="panel p-5" aria-labelledby="data-status-heading">
        <div className="mb-4 border-b border-slate-200 pb-3">
          <h2 id="data-status-heading" className="section-title">Data status</h2>
          <p className="mt-1 text-sm text-slate-600">Import and validation work that needs administrator attention.</p>
        </div>
        {tasks.length ? (
          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {tasks.map((task) => (
              <div key={task.title} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-950">{task.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{task.detail}</p>
                </div>
                <StatusBadge tone={task.status === 'Needs attention' ? 'warning' : task.status === 'Verified' ? 'positive' : 'neutral'}>{task.status}</StatusBadge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No pending data tasks" description="Import and validation issues will appear here." />
        )}

        {batches.length ? (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-slate-900">Latest import</h3>
            {batches.slice(0, 1).map((batch) => (
              <dl key={batch.batchId} className="mt-3 grid gap-3 rounded border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-4">
                <div className="sm:col-span-4"><dt className="text-xs text-slate-500">File</dt><dd className="mt-1 break-all font-medium text-slate-900">{batch.fileName}</dd></div>
                <div><dt className="text-xs text-slate-500">Status</dt><dd className="mt-1">{batch.status}</dd></div>
                <div><dt className="text-xs text-slate-500">Rows</dt><dd className="mt-1">{batch.rows}</dd></div>
                <div><dt className="text-xs text-slate-500">Rejected</dt><dd className="mt-1">{batch.rejected}</dd></div>
                <div><dt className="text-xs text-slate-500">Issues</dt><dd className="mt-1">{batch.issues}</dd></div>
              </dl>
            ))}
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
