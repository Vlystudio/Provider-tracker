import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { EmptyState, PageHeader, ResultsSummary, StatusBadge } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { requirePagePermission } from '@/server/authorization';
import { getResolvedDataMode } from '@/server/data-layer';
import { getDemoFacilities } from '@/server/demo-data';
import { getDataQualityDashboard, qualityIssueCodes, type QualityIssueCode } from '@/server/data-quality-service';

type QualityParams = { issue?: string; page?: string };

function href(issue: QualityIssueCode, page: number) {
  return `/data-quality?issue=${issue}&page=${page}`;
}

export default async function DataQualityPage({ searchParams }: { searchParams?: Promise<QualityParams> }) {
  const principal = await requirePagePermission('admin:read');
  const params: QualityParams = await Promise.resolve(searchParams ?? {});
  const issue = qualityIssueCodes.find((item) => item === params.issue) ?? 'all';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const dataMode = getResolvedDataMode();
  const dashboard = dataMode === 'demo'
    ? (() => {
        const facilities = getDemoFacilities();
        const qualityRows = facilities.map((facility, index) => {
          const issues: QualityIssueCode[] = [];
          if (facility.freshness === 'stale') issues.push('stale');
          if (facility.freshness === 'never_verified') issues.push('never_verified');
          if (facility.facilityName === 'Midcoast Center') issues.push('missing_coordinates');
          if (facility.facilityName === 'MaineHealth Cancer Care') issues.push('missing_phone');
          if (facility.facilityName === 'Topsham Specialty') issues.push('conflicting');
          return {
            ...facility,
            phone: facility.facilityName === 'MaineHealth Cancer Care' ? null : `(207) 555-010${index}`,
            postalCode: ['04011', '04086', '04086', '04530'][index] ?? null,
            issues,
          };
        });
        const rows = qualityRows.filter((facility) => issue === 'all' ? facility.issues.length > 0 : facility.issues.includes(issue));
        const issueCount = (code: QualityIssueCode) => qualityRows.filter((facility) => facility.issues.includes(code)).length;
        return {
          metrics: [
            { code: 'all' as const, label: 'Active records', count: facilities.length, href: '/facilities?status=active' },
            { code: 'stale' as const, label: 'Stale', count: issueCount('stale'), href: '/data-quality?issue=stale' },
            { code: 'never_verified' as const, label: 'Never verified', count: issueCount('never_verified'), href: '/data-quality?issue=never_verified' },
            { code: 'duplicates' as const, label: 'Duplicate candidates', count: 1, href: '/duplicates' },
            { code: 'missing_coordinates' as const, label: 'Missing coordinates', count: issueCount('missing_coordinates'), href: '/data-quality?issue=missing_coordinates' },
            { code: 'missing_phone' as const, label: 'Missing phone', count: issueCount('missing_phone'), href: '/data-quality?issue=missing_phone' },
            { code: 'conflicting' as const, label: 'Conflicting status', count: issueCount('conflicting'), href: '/data-quality?issue=conflicting' },
          ],
          rows: rows.map((facility) => ({
            facilityId: facility.facilityId,
            facilityName: facility.facilityName,
            city: facility.city,
            phone: facility.phone,
            postalCode: facility.postalCode,
            lastVerifiedAt: facility.lastVerifiedAt,
            issueLabel: (issue === 'all' ? facility.issues : [issue]).map((code) => code.replaceAll('_', ' ')).join(', '),
          })),
          total: rows.length,
          page: 1,
          pageSize: 25,
        };
      })()
    : await getDataQualityDashboard(principal, { issue, page, pageSize: 25 });
  const totalPages = Math.max(1, Math.ceil(dashboard.total / dashboard.pageSize));
  return (
    <AppShell user={principal} dataMode={dataMode}>
      <PageHeader eyebrow="System" title="Data quality" summary="Records that need a correction, a verification, or a duplicate decision." />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Data quality totals">
        {dashboard.metrics.map((metric) => <Link key={metric.code} href={metric.href} className="panel p-4 hover:border-slate-500"><p className="text-sm font-medium text-slate-700">{metric.label}</p><p className="mt-2 text-3xl font-semibold text-slate-950">{metric.count}</p></Link>)}
      </section>
      {dashboard.rows.length ? (
        <section className="table-shell" aria-labelledby="quality-records-heading">
          <div className="flex items-center justify-between border-b border-slate-300 px-4 py-3"><h2 id="quality-records-heading" className="section-title">Records</h2><ResultsSummary count={dashboard.total} noun="record" activeFilters={issue === 'all' ? 0 : 1} /></div>
          <div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">Facility</th><th scope="col">Issue</th><th scope="col">Phone</th><th scope="col">ZIP</th><th scope="col">Last verified</th></tr></thead><tbody>{dashboard.rows.map((row) => <tr key={row.facilityId}><td>{dataMode === 'database' ? <Link className="font-semibold text-slate-950 underline-offset-2 hover:underline" href={`/facilities/${row.facilityId}`}>{row.facilityName}</Link> : <span className="font-semibold text-slate-950">{row.facilityName}</span>}<span className="block text-xs text-slate-500">{row.city}</span></td><td><StatusBadge tone="warning">{row.issueLabel}</StatusBadge></td><td>{row.phone || 'Missing'}</td><td>{row.postalCode || 'Missing'}</td><td>{row.lastVerifiedAt ? formatDate(row.lastVerifiedAt) : 'Never'}</td></tr>)}</tbody></table></div>
          {totalPages > 1 ? <nav className="flex items-center justify-between border-t border-slate-300 px-4 py-3" aria-label="Data quality pages">{page > 1 ? <Link className="button button-secondary" href={href(issue, page - 1)}>Previous</Link> : <span />}{page < totalPages ? <Link className="button button-secondary" href={href(issue, page + 1)}>Next</Link> : <span />}</nav> : null}
        </section>
      ) : <EmptyState title="No records in this group" description="There is no work in the selected data-quality group." action={issue !== 'all' ? <Link className="button button-secondary" href="/data-quality">Show all issues</Link> : undefined} />}
    </AppShell>
  );
}
