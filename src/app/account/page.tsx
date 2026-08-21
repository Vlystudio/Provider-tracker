import { AppShell } from '@/components/app-shell';
import { AccountSessions } from '@/components/account-sessions';
import { PasswordChangeForm } from '@/components/password-change-form';
import { PageHeader } from '@/components/ui';
import { requirePagePermission } from '@/server/authorization';
import { getResolvedDataMode } from '@/server/data-layer';
import { listOwnSessions } from '@/server/user-administration';

export default async function AccountPage() {
  const principal = await requirePagePermission('app:access');
  const sessions = await listOwnSessions(principal);
  return (
    <AppShell user={principal} dataMode={getResolvedDataMode()}>
      <PageHeader eyebrow="Account" title="Account security" summary="Change your password and sign out other sessions." />
      <div className="grid gap-5">
        <PasswordChangeForm />
        <AccountSessions sessions={sessions.map((session) => ({
          id: session.id,
          current: session.current,
          startedLabel: session.createdAt.toLocaleString('en-US'),
          lastActiveLabel: session.lastSeenAt.toLocaleString('en-US'),
        }))} />
      </div>
    </AppShell>
  );
}
