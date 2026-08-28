import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { CallEntryForm } from '@/components/call-entry-form';
import { EmptyState, PageHeader } from '@/components/ui';
import { requirePagePermission } from '@/server/authorization';
import { getCallEntryOptions } from '@/server/call-service';
import { getResolvedDataMode } from '@/server/data-layer';

export default async function NewCallPage() {
  const principal = await requirePagePermission('operations:write');
  let options: Awaited<ReturnType<typeof getCallEntryOptions>> | null = null;
  let loadError: string | null = null;

  try {
    options = await getCallEntryOptions(principal);
  } catch {
    loadError = 'The call form could not be loaded. Try again or ask IT to check the database service.';
  }

  return (
    <AppShell user={principal} dataMode={getResolvedDataMode()} statusMessage={loadError}>
      <PageHeader eyebrow="Operations" title="Enter call" summary="Record a provider call and its result." />
      {options?.facilities.length ? (
        <CallEntryForm {...options} />
      ) : !loadError ? (
        <EmptyState
          title="No active facilities"
          description="Add or import facilities before entering a call."
          action={<Link className="button button-secondary" href="/facilities">Open facilities</Link>}
        />
      ) : null}
    </AppShell>
  );
}
