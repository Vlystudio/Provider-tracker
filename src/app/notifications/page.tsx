import { AppShell } from '@/components/app-shell';
import { NotificationCenter } from '@/components/notification-center';
import { PageHeader } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { requirePagePermission } from '@/server/authorization';
import { getResolvedDataMode } from '@/server/data-layer';
import { getNotificationPreferences, listNotifications } from '@/server/notification-service';
import { listOwnDigests } from '@/server/operational-service';

export default async function NotificationsPage() {
  const principal = await requirePagePermission('notifications:read');
  const dataMode = getResolvedDataMode();
  let statusMessage: string | null = null;
  let rows: Awaited<ReturnType<typeof listNotifications>>['rows'] = [];
  let digests: Awaited<ReturnType<typeof listOwnDigests>> = [];
  let preferences: Awaited<ReturnType<typeof getNotificationPreferences>> = { userId: principal.id, inAppEnabled: true, digestFrequency: 'daily', categories: ['work', 'changes', 'coverage', 'digest'], minimumSeverity: 'informational', updatedAt: new Date(0) };
  try {
    const [result, savedDigests] = await Promise.all([listNotifications(principal, { limit: 50 }), listOwnDigests(principal)]);
    rows = result.rows;
    digests = savedDigests;
    preferences = await getNotificationPreferences(principal);
  } catch {
    statusMessage = 'Notifications could not be loaded.';
  }
  return (
    <AppShell user={principal} dataMode={dataMode} statusMessage={statusMessage}>
      <PageHeader eyebrow="Workspace" title="Notifications" summary="New work, provider changes, coverage alerts, and saved summaries." />
      <NotificationCenter initialRows={rows} initialPreferences={preferences} />
      <section className="panel p-5" aria-labelledby="saved-summaries-heading">
        <h2 id="saved-summaries-heading" className="section-title">Saved summaries</h2>
        {digests.length ? <div className="mt-4 grid gap-4 md:grid-cols-2">{digests.map((digest) => <article className="rounded border border-slate-300 p-4" key={digest.id}><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-950">{digest.digestType === 'daily' ? 'Daily summary' : 'Weekly summary'}</h3><p className="mt-1 text-xs text-slate-500">{formatDateTime(digest.periodStart)} to {formatDateTime(digest.periodEnd)}</p></div><span className="text-xs text-slate-500">{formatDateTime(digest.generatedAt)}</span></div><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">{digest.sections.map((section) => <div key={section.key}><dt className="text-xs text-slate-600">{section.label}</dt><dd className="font-semibold text-slate-950">{section.count}</dd></div>)}</dl></article>)}</div> : <p className="mt-3 text-sm text-slate-600">No daily or weekly summaries have been saved yet.</p>}
      </section>
    </AppShell>
  );
}
