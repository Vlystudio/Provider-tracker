import { can } from '@/lib/access-control';
import { AppShell } from '@/components/app-shell';
import { GovernanceWorkspace } from '@/components/governance-workspace';
import { PageHeader } from '@/components/ui';
import { requirePagePermission } from '@/server/authorization';
import { getResolvedDataMode } from '@/server/data-layer';
import {
  currentReviewPeriod,
  listAccessReviewAccounts,
  listRetentionState,
  phase10PolicySnapshot,
} from '@/server/governance-service';

export default async function GovernancePage() {
  const principal = await requirePagePermission('governance:read');
  let loadError: string | null = null;
  let accounts: Awaited<ReturnType<typeof listAccessReviewAccounts>> = [];
  let retention: Awaited<ReturnType<typeof listRetentionState>> = { policies: [], holds: [] };
  try {
    [accounts, retention] = await Promise.all([
      listAccessReviewAccounts(principal),
      listRetentionState(principal),
    ]);
  } catch {
    loadError = 'Governance records could not be loaded. Confirm the Phase 10 database migration is applied.';
  }
  const snapshot = phase10PolicySnapshot({ retentionPolicies: retention.policies });

  return (
    <AppShell user={principal} dataMode={getResolvedDataMode()} statusMessage={loadError}>
      <PageHeader
        eyebrow="Oversight"
        title="Data governance"
        summary="Review staff access, retention holds, export limits, and security activity. Decisions require an authorized person."
        meta={`${accounts.length} accounts · ${snapshot.exportMaxRows} row export limit`}
      />
      {!loadError ? <GovernanceWorkspace
        initialAccounts={accounts.map((account) => ({
          ...account,
          createdAt: account.createdAt.toISOString(),
          lastSignedInAt: account.lastSignedInAt?.toISOString() ?? null,
          roleAssignedAt: account.roleAssignedAt?.toISOString() ?? null,
          lastSecurityActionAt: account.lastSecurityActionAt?.toISOString() ?? null,
          latestReview: account.latestReview ? {
            ...account.latestReview,
            decidedAt: account.latestReview.decidedAt?.toISOString() ?? null,
          } : null,
        }))}
        initialPolicies={retention.policies.map((policy) => ({
          ...policy,
          approvedAt: policy.approvedAt?.toISOString() ?? null,
          updatedAt: policy.updatedAt?.toISOString() ?? null,
        }))}
        initialHolds={retention.holds.map((hold) => ({
          ...hold,
          placedAt: hold.placedAt.toISOString(),
          releasedAt: hold.releasedAt?.toISOString() ?? null,
        }))}
        reviewPeriod={currentReviewPeriod()}
        canManage={can(principal.role, 'governance:manage')}
      /> : null}
    </AppShell>
  );
}
