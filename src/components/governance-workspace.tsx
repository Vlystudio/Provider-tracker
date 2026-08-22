'use client';

import { useState } from 'react';
import { formatDateTime, humanizeKey } from '@/lib/format';
import type { AccessReviewDecision } from '@/lib/governance';
import { InlineMessage, StatusBadge } from './ui';

type ReviewAccount = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'ura_user' | 'report_viewer' | 'auditor';
  isActive: boolean;
  createdAt: string;
  lastSignedInAt: string | null;
  roleAssignedAt: string | null;
  privileged: boolean;
  dormant: boolean;
  dormantDays: number;
  lastSecurityActionAt: string | null;
  recentSecurityActions: number;
  latestReview: { period: string; decision: string | null; decidedAt: string | null } | null;
};

type RetentionPolicy = {
  key: string;
  purpose: string;
  retentionDays: number | null;
  deletionEnabled: boolean;
  policyReference: string | null;
  approvedAt: string | null;
  updatedAt: string | null;
};

type Hold = {
  id: string;
  category: string;
  entityType: string | null;
  entityId: string | null;
  reasonCode: string;
  placedAt: string;
  releasedAt: string | null;
};

type TimelineEvent = {
  id: string;
  actorId: string | null;
  action: string;
  result: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

type IncidentReport = {
  subject: { name: string; email: string; role: string; isActive: boolean };
  period: { start: string; end: string };
  summary: Record<string, number>;
  events: Array<{ action: string; result: string; entityType: string; entityId: string | null; createdAt: string }>;
  truncated: boolean;
  eventLimit: number;
  evidenceLimitations: string[];
};

const decisions: Array<{ value: AccessReviewDecision; label: string }> = [
  { value: 'retain', label: 'Retain' },
  { value: 'modify', label: 'Modify' },
  { value: 'disable', label: 'Disable' },
  { value: 'investigate', label: 'Investigate' },
];

async function jsonRequest(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'The request failed.');
  return payload;
}

export function GovernanceWorkspace({
  initialAccounts,
  initialPolicies,
  initialHolds,
  timeline,
  reviewPeriod,
  canManage,
}: {
  initialAccounts: ReviewAccount[];
  initialPolicies: RetentionPolicy[];
  initialHolds: Hold[];
  timeline: TimelineEvent[];
  reviewPeriod: string;
  canManage: boolean;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [policies, setPolicies] = useState(initialPolicies);
  const [holds, setHolds] = useState(initialHolds);
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, AccessReviewDecision>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [incident, setIncident] = useState<IncidentReport | null>(null);
  const [dryRun, setDryRun] = useState<Record<string, unknown> | null>(null);

  async function saveDecision(account: ReviewAccount) {
    const decision = decisionDrafts[account.id] ?? 'retain';
    setPending(`review:${account.id}`);
    setMessage(null);
    try {
      await jsonRequest('/api/governance/access-reviews', 'POST', {
        reviewedUserId: account.id,
        reviewPeriod,
        decision,
      });
      setAccounts((current) => current.map((item) => item.id === account.id
        ? { ...item, latestReview: { period: reviewPeriod, decision, decidedAt: new Date().toISOString() } }
        : item));
      setMessage({ tone: 'success', text: `Review recorded for ${account.name}.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The review could not be saved.' });
    } finally {
      setPending(null);
    }
  }

  async function emergencyRevoke(account: ReviewAccount) {
    setPending(`revoke:${account.id}`);
    setMessage(null);
    try {
      const payload = await jsonRequest(`/api/governance/users/${account.id}/emergency-revoke`, 'POST') as {
        result?: { sessionsRevoked?: number; assignedWorkItems?: number };
      };
      setAccounts((current) => current.map((item) => item.id === account.id
        ? { ...item, role: 'ura_user', isActive: false, dormant: false }
        : item));
      setConfirmRevoke(null);
      setMessage({
        tone: 'warning',
        text: `${account.name} was disabled. ${payload.result?.sessionsRevoked ?? 0} sessions were revoked. Review ${payload.result?.assignedWorkItems ?? 0} assigned work items.`,
      });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Emergency revocation failed.' });
    } finally {
      setPending(null);
    }
  }

  async function savePolicy(event: React.FormEvent<HTMLFormElement>, policy: RetentionPolicy) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const enabled = form.get('deletionEnabled') === 'on';
    setPending(`policy:${policy.key}`);
    setMessage(null);
    try {
      const payload = await jsonRequest('/api/governance/retention', 'PATCH', {
        category: policy.key,
        retentionDays: form.get('retentionDays') ? Number(form.get('retentionDays')) : null,
        deletionEnabled: enabled,
        policyReference: form.get('policyReference') ? String(form.get('policyReference')).trim() : null,
        confirmation: String(form.get('confirmation') ?? ''),
      }) as { policy?: RetentionPolicy & { category?: string } };
      if (payload.policy) {
        setPolicies((current) => current.map((item) => item.key === policy.key ? {
          ...item,
          retentionDays: payload.policy!.retentionDays,
          deletionEnabled: payload.policy!.deletionEnabled,
          policyReference: payload.policy!.policyReference,
          approvedAt: payload.policy!.approvedAt,
          updatedAt: payload.policy!.updatedAt,
        } : item));
      }
      setMessage({ tone: 'success', text: `${policy.purpose} policy saved.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The retention policy could not be saved.' });
    } finally {
      setPending(null);
    }
  }

  async function runDryRun(category: string) {
    setPending(`dry:${category}`);
    setMessage(null);
    try {
      const payload = await jsonRequest('/api/governance/retention/dry-run', 'POST', { category }) as { result?: Record<string, unknown> };
      setDryRun(payload.result ?? null);
      setMessage({ tone: 'success', text: 'Dry run finished. No records were deleted.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The dry run failed.' });
    } finally {
      setPending(null);
    }
  }

  async function placeHold(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending('hold:new');
    setMessage(null);
    try {
      const payload = await jsonRequest('/api/governance/holds', 'POST', {
        category: String(form.get('category')),
        entityType: form.get('entityType') ? String(form.get('entityType')).trim() : null,
        entityId: form.get('entityId') ? String(form.get('entityId')).trim() : null,
        reasonCode: String(form.get('reasonCode')).trim(),
      }) as { hold?: Hold };
      if (payload.hold) setHolds((current) => [payload.hold!, ...current]);
      event.currentTarget.reset();
      setMessage({ tone: 'success', text: 'Retention hold placed.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The hold could not be placed.' });
    } finally {
      setPending(null);
    }
  }

  async function releaseHold(event: React.FormEvent<HTMLFormElement>, hold: Hold) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(`hold:${hold.id}`);
    setMessage(null);
    try {
      await jsonRequest(`/api/governance/holds/${hold.id}`, 'DELETE', {
        reasonCode: String(form.get('reasonCode')).trim(),
      });
      setHolds((current) => current.map((item) => item.id === hold.id ? { ...item, releasedAt: new Date().toISOString() } : item));
      setMessage({ tone: 'success', text: 'Retention hold released.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The hold could not be released.' });
    } finally {
      setPending(null);
    }
  }

  async function investigate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending('incident');
    setMessage(null);
    setIncident(null);
    try {
      const payload = await jsonRequest('/api/governance/incidents/scope', 'POST', {
        userId: String(form.get('userId')),
        start: new Date(String(form.get('start'))).toISOString(),
        end: new Date(String(form.get('end'))).toISOString(),
      }) as { report?: IncidentReport };
      setIncident(payload.report ?? null);
      setMessage({ tone: 'success', text: 'Investigation report created from available application evidence.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The investigation report could not be created.' });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-5">
      {message ? <InlineMessage tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</InlineMessage> : null}

      <section className="table-shell" aria-labelledby="access-review-heading">
        <div className="border-b border-slate-300 px-4 py-3">
          <h2 id="access-review-heading" className="section-title">Access review · {reviewPeriod}</h2>
          <p className="mt-1 text-sm text-slate-600">Dormant flags need a person to decide what happens. Nothing is disabled automatically.</p>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th scope="col">Account</th><th scope="col">Access</th><th scope="col">Last sign-in</th><th scope="col">Last review</th>{canManage ? <th scope="col">Decision</th> : null}</tr></thead>
            <tbody>{accounts.map((account) => <tr key={account.id}>
              <td><span className="block font-semibold text-slate-950">{account.name}</span><span className="block text-xs text-slate-500">{account.email}</span></td>
              <td><span className="block">{humanizeKey(account.role)}</span><div className="mt-1 flex gap-1">{account.isActive ? <StatusBadge tone="positive">Active</StatusBadge> : <StatusBadge>Inactive</StatusBadge>}{account.privileged ? <StatusBadge tone="warning">Privileged</StatusBadge> : null}{account.dormant ? <StatusBadge tone="warning">Dormant</StatusBadge> : null}</div></td>
              <td>{account.lastSignedInAt ? formatDateTime(account.lastSignedInAt) : <><span className="block">No sign-in recorded</span><span className="text-xs text-slate-500">Created {formatDateTime(account.createdAt)}</span></>}</td>
              <td>{account.latestReview ? <><span className="block">{humanizeKey(account.latestReview.decision ?? '')}</span><span className="text-xs text-slate-500">{account.latestReview.period} · {account.latestReview.decidedAt ? formatDateTime(account.latestReview.decidedAt) : 'time unavailable'}</span></> : 'Not reviewed'}</td>
              {canManage ? <td className="min-w-72"><div className="flex flex-wrap gap-2"><select className="form-control mt-0 w-32" aria-label={`Decision for ${account.name}`} value={decisionDrafts[account.id] ?? 'retain'} onChange={(event) => setDecisionDrafts((current) => ({ ...current, [account.id]: event.target.value as AccessReviewDecision }))}>{decisions.map((decision) => <option key={decision.value} value={decision.value}>{decision.label}</option>)}</select><button className="button button-secondary" type="button" disabled={pending !== null} onClick={() => saveDecision(account)}>Record</button>{account.isActive && account.id !== undefined ? confirmRevoke === account.id ? <span className="inline-flex gap-2 rounded border border-red-300 bg-red-50 p-2"><button className="button button-danger" type="button" disabled={pending !== null} onClick={() => emergencyRevoke(account)}>Confirm revoke</button><button className="button button-secondary" type="button" onClick={() => setConfirmRevoke(null)}>Cancel</button></span> : <button className="button button-secondary" type="button" disabled={pending !== null} onClick={() => setConfirmRevoke(account.id)}>Emergency revoke</button> : null}</div></td> : null}
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="panel p-5" aria-labelledby="retention-heading">
        <div className="mb-4 border-b border-slate-200 pb-3"><h2 id="retention-heading" className="section-title">Retention controls</h2><p className="mt-1 text-sm text-slate-600">No deletion runs until an approved policy is entered and deletion is enabled. Dry runs never delete.</p></div>
        <div className="space-y-4">{policies.map((policy) => canManage ? <form key={policy.key} onSubmit={(event) => savePolicy(event, policy)} className="rounded border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-950">{policy.purpose}</h3><p className="mt-1 text-xs text-slate-500">{policy.key}</p></div><StatusBadge tone={policy.deletionEnabled ? 'warning' : 'neutral'}>{policy.deletionEnabled ? 'Deletion enabled' : 'Retained'}</StatusBadge></div><div className="mt-4 grid gap-3 md:grid-cols-4"><label className="form-label">Days<input className="form-control" name="retentionDays" type="number" min={1} max={36500} defaultValue={policy.retentionDays ?? ''} /></label><label className="form-label md:col-span-2">Approved policy reference<input className="form-control" name="policyReference" maxLength={200} defaultValue={policy.policyReference ?? ''} placeholder="Policy ID or controlled document" /></label><label className="form-label">Enable deletion<span className="mt-3 flex items-center gap-2 font-normal"><input name="deletionEnabled" type="checkbox" defaultChecked={policy.deletionEnabled} /> Approved</span></label><label className="form-label md:col-span-2">Confirmation<input className="form-control" name="confirmation" autoComplete="off" placeholder="ENABLE RETENTION" /></label></div><div className="mt-4 flex gap-2"><button className="button button-primary" type="submit" disabled={pending !== null}>Save policy</button><button className="button button-secondary" type="button" disabled={pending !== null} onClick={() => runDryRun(policy.key)}>Run dry run</button></div></form> : <div key={policy.key} className="flex items-center justify-between rounded border border-slate-200 p-4"><div><h3 className="font-semibold text-slate-950">{policy.purpose}</h3><p className="mt-1 text-xs text-slate-500">{policy.retentionDays ? `${policy.retentionDays} days · ${policy.policyReference ?? 'reference missing'}` : 'No retention period approved'}</p></div><StatusBadge tone={policy.deletionEnabled ? 'warning' : 'neutral'}>{policy.deletionEnabled ? 'Deletion enabled' : 'Retained'}</StatusBadge></div>)}</div>
        {dryRun ? <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><h3 className="font-semibold">Latest dry run</h3><dl className="mt-2 grid gap-2 sm:grid-cols-4"><div><dt>Category</dt><dd className="font-medium">{String(dryRun.category)}</dd></div><div><dt>Cutoff</dt><dd className="font-medium">{dryRun.cutoff ? formatDateTime(String(dryRun.cutoff)) : 'Not configured'}</dd></div><div><dt>Eligible</dt><dd className="font-medium">{String(dryRun.eligibleRecords ?? 0)}</dd></div><div><dt>Held</dt><dd className="font-medium">{String(dryRun.heldRecords ?? 0)}</dd></div></dl></div> : null}
      </section>

      <section className="panel p-5" aria-labelledby="holds-heading">
        <div className="mb-4 border-b border-slate-200 pb-3"><h2 id="holds-heading" className="section-title">Retention holds</h2><p className="mt-1 text-sm text-slate-600">A category-wide hold protects every eligible record. Add an entity only for a narrower hold.</p></div>
        {canManage ? <form onSubmit={placeHold} className="grid gap-3 md:grid-cols-4"><label className="form-label">Category<select className="form-control" name="category">{policies.map((policy) => <option key={policy.key} value={policy.key}>{policy.purpose}</option>)}</select></label><label className="form-label">Entity type<input className="form-control" name="entityType" placeholder="Optional table name" /></label><label className="form-label">Entity ID<input className="form-control" name="entityId" placeholder="Optional record ID" /></label><label className="form-label">Reason code<input className="form-control" name="reasonCode" pattern="[a-z][a-z0-9_]*" placeholder="incident_preservation" required /></label><div className="md:col-span-4"><button className="button button-primary" type="submit" disabled={pending !== null}>Place hold</button></div></form> : null}
        <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">{holds.length ? holds.map((hold) => <div key={hold.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><span className="font-semibold text-slate-950">{humanizeKey(hold.category)}</span><span className="ml-2 text-slate-600">{humanizeKey(hold.reasonCode)}</span><span className="block text-xs text-slate-500">Placed {formatDateTime(hold.placedAt)}{hold.entityId ? ` · ${hold.entityType}:${hold.entityId}` : ' · whole category'}</span></div>{hold.releasedAt ? <StatusBadge>Released</StatusBadge> : canManage ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => releaseHold(event, hold)}><label className="form-label">Release reason<input className="form-control" name="reasonCode" pattern="[a-z][a-z0-9_]*" placeholder="matter_closed" required /></label><button className="button button-secondary" type="submit" disabled={pending !== null}>Release</button></form> : <StatusBadge tone="warning">Active</StatusBadge>}</div>) : <p className="py-4 text-sm text-slate-600">No holds recorded.</p>}</div>
      </section>

      <section className="panel p-5" aria-labelledby="investigation-heading">
        <div className="mb-4 border-b border-slate-200 pb-3"><h2 id="investigation-heading" className="section-title">Account investigation</h2><p className="mt-1 text-sm text-slate-600">Builds a timeline from available application evidence. It does not determine legal breach scope.</p></div>
        <form onSubmit={investigate} className="grid gap-3 md:grid-cols-4"><label className="form-label md:col-span-2">Account<select className="form-control" name="userId" required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.email}</option>)}</select></label><label className="form-label">Start<input className="form-control" name="start" type="datetime-local" required /></label><label className="form-label">End<input className="form-control" name="end" type="datetime-local" required /></label><div className="md:col-span-4"><button className="button button-primary" type="submit" disabled={pending !== null}>Build report</button></div></form>
        {incident ? <div className="mt-5"><h3 className="font-semibold text-slate-950">{incident.subject.name}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(incident.summary).map(([key, value]) => <div key={key} className="rounded border border-slate-200 p-3"><p className="text-xs text-slate-500">{humanizeKey(key)}</p><p className="mt-1 text-xl font-semibold text-slate-950">{value}</p></div>)}</div>{incident.truncated ? <InlineMessage tone="warning" title="Event limit reached">The report stopped at {incident.eventLimit} events. Narrow the time window.</InlineMessage> : null}<div className="mt-4 table-scroll max-h-96"><table className="data-table"><thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Result</th></tr></thead><tbody>{incident.events.map((item, index) => <tr key={`${item.createdAt}-${index}`}><td>{formatDateTime(item.createdAt)}</td><td>{humanizeKey(item.action)}</td><td>{humanizeKey(item.entityType)}{item.entityId ? ` · ${item.entityId}` : ''}</td><td>{humanizeKey(item.result)}</td></tr>)}</tbody></table></div><div className="mt-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><h4 className="font-semibold">Evidence limits</h4><ul className="mt-2 list-disc space-y-1 pl-5">{incident.evidenceLimitations.map((item) => <li key={item}>{item}</li>)}</ul></div></div> : null}
      </section>

      <section className="table-shell" aria-labelledby="security-timeline-heading"><div className="border-b border-slate-300 px-4 py-3"><h2 id="security-timeline-heading" className="section-title">Security timeline</h2><p className="mt-1 text-sm text-slate-600">Authentication, denied access, account changes, exports, migration, retention, and investigation activity.</p></div><div className="table-scroll max-h-[32rem]"><table className="data-table"><thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Result</th></tr></thead><tbody>{timeline.map((event) => <tr key={event.id}><td>{formatDateTime(event.createdAt)}</td><td>{humanizeKey(event.action)}</td><td>{humanizeKey(event.entityType)}{event.entityId ? ` · ${event.entityId}` : ''}</td><td>{humanizeKey(event.result)}</td></tr>)}</tbody></table></div></section>
    </div>
  );
}
