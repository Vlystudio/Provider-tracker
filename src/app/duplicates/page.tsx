import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { DuplicateRefreshButton, DuplicateReviewActions } from '@/components/duplicate-review-actions';
import { EmptyState, PageHeader, StatusBadge, type StatusTone } from '@/components/ui';
import { requirePagePermission } from '@/server/authorization';
import { listDuplicateCandidates } from '@/server/data-quality-service';
import { getResolvedDataMode } from '@/server/data-layer';

type DuplicateParams = { page?: string };

function tone(confidence: string): StatusTone {
  if (confidence === 'exact') return 'danger';
  if (confidence === 'probable') return 'warning';
  return 'info';
}

export default async function DuplicatesPage({ searchParams }: { searchParams?: Promise<DuplicateParams> }) {
  const principal = await requirePagePermission('admin:read');
  const params: DuplicateParams = await Promise.resolve(searchParams ?? {});
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const data = await listDuplicateCandidates(principal, page);
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <AppShell user={principal} dataMode={getResolvedDataMode()}>
      <PageHeader eyebrow="System" title="Duplicate review" summary="Compare likely matches before deciding whether records should remain separate or be merged." meta={<DuplicateRefreshButton />} />
      {data.rows.length ? <div className="space-y-4">{data.rows.map((candidate) => (
        <section key={candidate.id} className="panel p-4" aria-labelledby={`duplicate-${candidate.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id={`duplicate-${candidate.id}`} className="section-title">Facility comparison</h2><p className="mt-1 text-xs text-slate-500">{candidate.reasons.join(' · ')}</p></div><div className="flex gap-2"><StatusBadge tone={tone(candidate.confidence)}>{candidate.confidence}</StatusBadge><StatusBadge>{candidate.score}/100</StatusBadge></div></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {[candidate.left, candidate.right].map((side) => <div key={side.id} className="rounded border border-slate-300 p-4"><Link className="font-semibold text-slate-950 underline-offset-2 hover:underline" href={`/facilities/${side.id}`}>{side.name}</Link><dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm"><dt className="text-slate-500">City</dt><dd>{side.city}</dd><dt className="text-slate-500">Phone</dt><dd>{side.phone || 'Missing'}</dd><dt className="text-slate-500">ZIP</dt><dd>{side.postalCode || 'Missing'}</dd><dt className="text-slate-500">Coordinates</dt><dd>{side.latitude !== null && side.longitude !== null ? `${side.latitude.toFixed(4)}, ${side.longitude.toFixed(4)}` : 'Missing'}</dd><dt className="text-slate-500">Specialties</dt><dd>{side.specialties}</dd><dt className="text-slate-500">History</dt><dd>{side.verificationCount} verifications · {side.callCount} calls</dd></dl></div>)}
          </div>
          <DuplicateReviewActions candidateId={candidate.id} left={candidate.left} right={candidate.right} />
        </section>
      ))}<nav className="flex items-center justify-between" aria-label="Duplicate review pages">{page > 1 ? <Link className="button button-secondary" href={`/duplicates?page=${page - 1}`}>Previous</Link> : <span />}{page < totalPages ? <Link className="button button-secondary" href={`/duplicates?page=${page + 1}`}>Next</Link> : <span />}</nav></div> : <EmptyState title="No duplicate candidates" description="Run the candidate scan after an import or facility maintenance work." />}
    </AppShell>
  );
}
