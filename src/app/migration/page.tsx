import { AppShell } from '@/components/app-shell';
import { MigrationConsole } from '@/components/migration-console';
import { PageHeader } from '@/components/ui';
import { requirePagePermission } from '@/server/authorization';
import { getResolvedDataMode } from '@/server/data-layer';
import { listMigrationRuns } from '@/server/migration-service';

export default async function MigrationPage() {
  const principal = await requirePagePermission('migration:read');
  const runs = await listMigrationRuns();
  return (
    <AppShell user={principal} dataMode={getResolvedDataMode()}>
      <PageHeader eyebrow="System" title="Data migration" summary="Check the legacy workbooks, fix matching issues, apply the import, and confirm the totals." />
      <MigrationConsole initialRuns={runs as never} />
    </AppShell>
  );
}
