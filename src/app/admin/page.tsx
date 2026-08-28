import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/ui';
import { UserManagement, type ManagedUser } from '@/components/user-management';
import { getResolvedDataMode } from '@/server/data-layer';
import { requirePagePermission } from '@/server/authorization';
import { listUsersForAdministrator } from '@/server/user-administration';

export default async function AdminPage() {
  const principal = await requirePagePermission('admin:read');
  const dataMode = getResolvedDataMode();
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

  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={userLoadError}>
      <PageHeader
        eyebrow="System"
        title="Administration"
        summary="Manage staff access. Account changes take effect immediately."
      />

      {userLoadError ? null : <UserManagement initialUsers={users} currentUserId={principal.id} />}
    </AppShell>
  );
}
