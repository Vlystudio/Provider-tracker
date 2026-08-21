import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { FacilityActions } from '@/components/facility-actions';
import { InlineMessage, PageHeader, StatusBadge, type StatusTone } from '@/components/ui';
import { can } from '@/lib/access-control';
import { assessFacilityQuality, classifyFreshness, freshnessLabel } from '@/lib/provider-intelligence';
import { formatDate, formatDateTime, humanizeKey } from '@/lib/format';
import { requirePagePermission } from '@/server/authorization';
import { getResolvedDataMode } from '@/server/data-layer';
import { getFreshnessPolicy } from '@/server/config';
import { getFacilityDetail, listFacilityReferenceOptions } from '@/server/provider-intelligence-service';

function tone(value: string): StatusTone {
  if (value === 'yes' || value === 'fresh') return 'positive';
  if (value === 'no') return 'danger';
  if (value === 'aging' || value === 'stale' || value === 'unable_to_verify') return 'warning';
  return 'neutral';
}

function verifiedFacts(event: NonNullable<Awaited<ReturnType<typeof getFacilityDetail>>>['verifications'][number]): string[] {
  const facts: string[] = [];
  if (event.acceptingStatus) facts.push(`Accepting: ${humanizeKey(event.acceptingStatus)}`);
  if (event.specialtyStatus) facts.push(`Specialty: ${humanizeKey(event.specialtyStatus)}`);
  if (event.diagnosisStatus) facts.push(`Diagnosis: ${humanizeKey(event.diagnosisStatus)}`);
  if (event.schedulingWithinFourWeeks) facts.push(`Within four weeks: ${humanizeKey(event.schedulingWithinFourWeeks)}`);
  if (event.urgentReferralStatus) facts.push(`Urgent referral: ${humanizeKey(event.urgentReferralStatus)}`);
  if (event.nextAvailableDate) facts.push(`Next date: ${formatDate(event.nextAvailableDate)}`);
  if (event.estimatedWaitDays !== null) facts.push(`Wait: ${event.estimatedWaitDays} days`);
  return facts;
}

export default async function FacilityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePagePermission('operations:read');
  const { id } = await params;
  const detail = await getFacilityDetail(principal, id).catch(() => null);
  if (!detail) notFound();
  const references = can(principal.role, 'operations:write') && detail.facility.active
    ? await listFacilityReferenceOptions(principal)
    : { specialties: [], diagnoses: [] };
  const facility = detail.facility;
  const freshness = classifyFreshness('accepting', facility.acceptingVerifiedAt, new Date(), getFreshnessPolicy());
  const recentAnswers = detail.verifications
    .filter((event) => event.acceptingStatus === 'yes' || event.acceptingStatus === 'no')
    .slice(0, 2)
    .map((event) => event.acceptingStatus);
  const issues = assessFacilityQuality({
    phoneNormalized: facility.phoneNormalized,
    postalCode: facility.postalCode,
    addressLine1: facility.addressLine1,
    latitude: facility.latitude,
    longitude: facility.longitude,
    lastVerifiedAt: facility.acceptingVerifiedAt,
    nextAvailableDate: facility.nextAvailableDate,
    hasUnresolvedDuplicate: detail.duplicateCandidates.length > 0,
    hasConflictingAcceptingStatus: recentAnswers.length === 2 && recentAnswers[0] !== recentAnswers[1],
  });
  const timeline = [
    ...detail.verifications.map((event) => ({ type: 'verification' as const, at: event.verifiedAt, event })),
    ...detail.contacts.map((event) => ({ type: 'contact' as const, at: event.attemptedAt, event })),
  ].sort((left, right) => right.at.valueOf() - left.at.valueOf()).slice(0, 50);

  return (
    <AppShell user={principal} dataMode={getResolvedDataMode()}>
      <div className="flex flex-wrap items-center gap-2 text-sm"><Link className="button-link" href="/facilities">Facilities</Link><span aria-hidden="true">/</span><span className="text-slate-600">{facility.facilityName}</span></div>
      <PageHeader eyebrow="Facility record" title={facility.facilityName} summary={`${facility.city}${facility.stateCode ? `, ${facility.stateCode}` : ''}${facility.postalCode ? ` ${facility.postalCode}` : ''}`} meta={<StatusBadge tone={facility.active ? 'positive' : 'neutral'}>{facility.active ? 'Active' : 'Archived'}</StatusBadge>} />

      {!facility.active && facility.mergedIntoFacilityId ? <InlineMessage tone="info" title="Merged record">This record is archived. Current work continues on the surviving facility record.</InlineMessage> : null}
      {issues.length ? <InlineMessage tone={issues.some((issue) => issue.severity === 'error') ? 'error' : 'warning'} title="Data needs attention"><ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue.code}>{issue.label}</li>)}</ul></InlineMessage> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Current facility status">
        <div className="panel p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accepting</p><p className="mt-2"><StatusBadge tone={tone(facility.currentAcceptingStatus)}>{humanizeKey(facility.currentAcceptingStatus)}</StatusBadge></p><p className="mt-2 text-xs text-slate-600">{freshnessLabel(freshness)}</p></div>
        <div className="panel p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduling</p><p className="mt-2"><StatusBadge tone={tone(facility.currentSchedulingStatus)}>{humanizeKey(facility.currentSchedulingStatus)}</StatusBadge></p><p className="mt-2 text-xs text-slate-600">{facility.estimatedWaitDays !== null ? `${facility.estimatedWaitDays} day estimated wait` : 'Wait not recorded'}</p></div>
        <div className="panel p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Urgent referral</p><p className="mt-2"><StatusBadge tone={tone(facility.currentUrgentReferralStatus)}>{humanizeKey(facility.currentUrgentReferralStatus)}</StatusBadge></p><p className="mt-2 text-xs text-slate-600">{facility.nextAvailableDate ? `Next date ${formatDate(facility.nextAvailableDate)}` : 'Next date not recorded'}</p></div>
        <div className="panel p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</p><p className="mt-2 font-medium text-slate-950">{facility.phoneRaw || 'Phone not recorded'}</p><p className="mt-2 text-xs text-slate-600">{humanizeKey(facility.coordinateQuality)} coordinates</p></div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="table-shell" aria-labelledby="specialties-heading"><div className="border-b border-slate-300 px-4 py-3"><h2 id="specialties-heading" className="section-title">Specialties</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">Specialty</th><th scope="col">Status</th><th scope="col">Last verified</th></tr></thead><tbody>{detail.specialties.length ? detail.specialties.map((item) => <tr key={item.id}><td>{item.name}</td><td><StatusBadge tone={tone(item.status)}>{humanizeKey(item.status)}</StatusBadge></td><td>{item.lastVerifiedAt ? formatDate(item.lastVerifiedAt) : 'Never'}</td></tr>) : <tr><td colSpan={3}>No specialties recorded.</td></tr>}</tbody></table></div></section>
        <section className="table-shell" aria-labelledby="diagnoses-heading"><div className="border-b border-slate-300 px-4 py-3"><h2 id="diagnoses-heading" className="section-title">Diagnosis capability</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">Diagnosis</th><th scope="col">Treats</th><th scope="col">Last verified</th></tr></thead><tbody>{detail.diagnoses.length ? detail.diagnoses.map((item) => <tr key={item.id}><td><span className="font-medium">{item.code}</span><span className="block text-xs text-slate-500">{item.description}</span></td><td><StatusBadge tone={tone(item.status)}>{humanizeKey(item.status)}</StatusBadge></td><td>{item.lastVerifiedAt ? formatDate(item.lastVerifiedAt) : 'Never'}</td></tr>) : <tr><td colSpan={3}>No diagnosis capabilities recorded.</td></tr>}</tbody></table></div></section>
      </div>

      {can(principal.role, 'operations:write') && facility.active ? <FacilityActions facilityId={facility.id} version={facility.optimisticLockVersion} specialties={references.specialties} diagnoses={references.diagnoses} /> : null}

      <section className="space-y-3" aria-labelledby="history-heading">
        <div><h2 id="history-heading" className="section-title">History</h2><p className="mt-1 text-sm text-slate-600">Verification and contact activity, newest first.</p></div>
        {timeline.length ? <ol className="space-y-3">{timeline.map((item) => item.type === 'verification' ? (
          <li key={`v-${item.event.id}`} className="panel p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-slate-950">Verification · {humanizeKey(item.event.method)}</p><p className="mt-1 text-xs text-slate-500">{item.event.actorName || 'Imported record'} · {humanizeKey(item.event.confidence)}</p></div><time className="text-xs text-slate-500">{formatDateTime(item.event.verifiedAt)}</time></div><p className="mt-3 text-sm text-slate-700">{verifiedFacts(item.event).join(' · ') || 'Comment recorded'}</p>{item.event.comments ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{item.event.comments}</p> : null}</li>
        ) : (
          <li key={`c-${item.event.id}`} className="panel p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-slate-950">Contact attempt · {humanizeKey(item.event.outcome)}</p><p className="mt-1 text-xs text-slate-500">{item.event.actorName || 'Imported record'} · {humanizeKey(item.event.method)}</p></div><time className="text-xs text-slate-500">{formatDateTime(item.event.attemptedAt)}</time></div>{item.event.comments ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{item.event.comments}</p> : null}</li>
        ))}</ol> : <p className="panel p-4 text-sm text-slate-600">No activity has been recorded.</p>}
      </section>
    </AppShell>
  );
}
