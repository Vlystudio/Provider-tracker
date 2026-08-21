'use client';

import { useState } from 'react';
import { InlineMessage, StatusBadge } from './ui';

type MigrationRun = {
  id: string;
  status: string;
  readiness: 'go' | 'go_with_warnings' | 'no_go';
  createdAt: string;
  previewCounts?: Record<string, number>;
};

type Diagnostic = {
  id: string;
  status: string;
  severity: string;
  entityType: string;
  sheetName: string;
  sourceRow: number;
  issueCode: string;
  message: string;
  suggestedAction: string | null;
  rowKey: string | null;
  optimisticLockVersion: number;
};

type MigrationDetails = {
  run: MigrationRun;
  sources: Array<{ id: string; workbookKind: string; sourceFileName: string; sourceHash: string; rowsScanned: number; formulaCells: number; hiddenRows: number }>;
  diagnostics: Diagnostic[];
  reconciliation: Record<string, unknown> | null;
};

function toneForReadiness(readiness: MigrationRun['readiness']) {
  return readiness === 'go' ? 'positive' : readiness === 'go_with_warnings' ? 'warning' : 'danger';
}

function readable(value: string) {
  return value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

async function responseJson(response: Response) {
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Request failed.');
  return body;
}

export function MigrationConsole({ initialRuns }: { initialRuns: MigrationRun[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [details, setDetails] = useState<MigrationDetails | null>(null);
  const [adminFile, setAdminFile] = useState<File | null>(null);
  const [userFile, setUserFile] = useState<File | null>(null);
  const [reason, setReason] = useState('Approved after migration preview review');
  const [targetIds, setTargetIds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  async function refreshRuns() {
    const response = await fetch('/api/admin/migrations', { cache: 'no-store' });
    const body = await responseJson(response) as { runs: MigrationRun[] };
    setRuns(body.runs);
  }

  async function openRun(id: string) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/migrations/${id}`, { cache: 'no-store' });
      setDetails(await responseJson(response) as MigrationDetails);
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Migration details could not be loaded.' });
    } finally { setBusy(false); }
  }

  async function preview(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage({ tone: 'info', text: 'Reading and checking the workbook files…' });
    try {
      const form = new FormData();
      if (adminFile) form.set('admin', adminFile);
      if (userFile) form.set('user', userFile);
      const response = await fetch('/api/admin/migrations', { method: 'POST', body: form });
      const body = await responseJson(response) as { run: MigrationRun };
      await refreshRuns();
      await openRun(body.run.id);
      setMessage({ tone: 'success', text: 'Preview finished. Review the issues and totals before applying it.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Preview failed.' });
    } finally { setBusy(false); }
  }

  async function applyRun() {
    if (!details) return;
    setBusy(true); setMessage({ tone: 'info', text: 'Applying the approved migration…' });
    try {
      const form = new FormData();
      if (adminFile) form.set('admin', adminFile);
      if (userFile) form.set('user', userFile);
      form.set('reason', reason);
      const response = await fetch(`/api/admin/migrations/${details.run.id}/apply`, { method: 'POST', body: form });
      await responseJson(response);
      await refreshRuns();
      await openRun(details.run.id);
      setMessage({ tone: 'success', text: 'Migration applied and reconciled.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Migration failed.' });
    } finally { setBusy(false); }
  }

  async function resolveDiagnostic(item: Diagnostic, action: 'use_existing' | 'create_new' | 'skip' | 'defer') {
    if (!details) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/migrations/${details.run.id}/diagnostics/${item.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, targetEntityId: targetIds[item.id] || null, note: `${readable(action)} during migration review`, version: item.optimisticLockVersion }),
      });
      await responseJson(response);
      await openRun(details.run.id);
      setMessage({ tone: 'success', text: 'Review item updated.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Review item could not be updated.' });
    } finally { setBusy(false); }
  }

  const openBlockers = details?.diagnostics.filter((item) => item.severity === 'error' && ['open', 'deferred'].includes(item.status)).length ?? 0;

  return (
    <div className="space-y-5">
      {message ? <InlineMessage tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</InlineMessage> : null}

      <form className="panel p-5" onSubmit={preview}>
        <h2 className="section-title">New preview</h2>
        <p className="mt-1 text-sm text-slate-600">Files are checked in a temporary folder and removed after the preview. Only hashes, counts, and review items are kept.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="form-label">Admin workbook
            <input className="form-control" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setAdminFile(event.target.files?.[0] ?? null)} />
          </label>
          <label className="form-label">User workbook
            <input className="form-control" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setUserFile(event.target.files?.[0] ?? null)} />
          </label>
        </div>
        <div className="mt-4 flex justify-end"><button className="button button-primary" disabled={busy || (!adminFile && !userFile)} type="submit">Run preview</button></div>
      </form>

      <section className="panel p-5" aria-labelledby="migration-history-heading">
        <div className="flex items-center justify-between gap-3">
          <div><h2 id="migration-history-heading" className="section-title">Migration history</h2><p className="mt-1 text-sm text-slate-600">Select a run to see its files, review items, and reconciliation.</p></div>
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => void refreshRuns()}>Refresh</button>
        </div>
        <div className="table-scroll mt-4 border-y border-slate-200">
          <table className="data-table"><thead><tr><th>Date</th><th>Status</th><th>Readiness</th><th>Rows</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{runs.map((run) => <tr key={run.id}><td>{new Date(run.createdAt).toLocaleString()}</td><td>{readable(run.status)}</td><td><StatusBadge tone={toneForReadiness(run.readiness)}>{readable(run.readiness)}</StatusBadge></td><td>{run.previewCounts?.rowsVisited ?? '—'}</td><td className="text-right"><button className="button-link" type="button" disabled={busy} onClick={() => void openRun(run.id)}>Open</button></td></tr>)}</tbody>
          </table>
        </div>
      </section>

      {details ? <section className="panel p-5" aria-labelledby="migration-details-heading">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div><h2 id="migration-details-heading" className="section-title">Run {details.run.id.slice(0, 8)}</h2><p className="mt-1 text-sm text-slate-600">{details.sources.map((source) => source.sourceFileName).join(' and ')}</p></div>
          <div className="flex gap-2"><StatusBadge tone={toneForReadiness(details.run.readiness)}>{readable(details.run.readiness)}</StatusBadge><a className="button button-secondary" href={`/api/admin/migrations/${details.run.id}/diagnostics.csv`}>Export issues</a></div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Status</dt><dd className="font-medium">{readable(details.run.status)}</dd></div>
          <div><dt className="text-slate-500">Files</dt><dd className="font-medium">{details.sources.length}</dd></div>
          <div><dt className="text-slate-500">Rows scanned</dt><dd className="font-medium">{details.sources.reduce((sum, source) => sum + source.rowsScanned, 0)}</dd></div>
          <div><dt className="text-slate-500">Open blockers</dt><dd className="font-medium">{openBlockers}</dd></div>
        </dl>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-900">Review items</h3>
          {details.diagnostics.length ? <div className="mt-2 space-y-2">{details.diagnostics.map((item) => <div key={item.id} className="rounded border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-900">{readable(item.issueCode)}</p><StatusBadge tone={item.severity === 'error' ? 'danger' : item.status === 'resolved' || item.status === 'skipped' ? 'positive' : 'warning'}>{readable(item.status)}</StatusBadge></div>
            <p className="mt-1 text-slate-700">{item.message}</p><p className="mt-1 text-xs text-slate-500">{item.sheetName}{item.sourceRow ? `, row ${item.sourceRow}` : ''} · {item.suggestedAction}</p>
            {['open', 'deferred'].includes(item.status) ? <div className="mt-3 flex flex-wrap items-end gap-2">
              {['facility', 'specialty', 'diagnosis', 'actor'].includes(item.entityType) ? <label className="form-label min-w-64 flex-1">Existing record ID<input className="form-control" value={targetIds[item.id] ?? ''} onChange={(event) => setTargetIds((current) => ({ ...current, [item.id]: event.target.value }))} /></label> : null}
              {targetIds[item.id] ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void resolveDiagnostic(item, 'use_existing')}>Use existing</button> : null}
              {['specialty', 'diagnosis'].includes(item.entityType) ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void resolveDiagnostic(item, 'create_new')}>Create new</button> : null}
              <button className="button button-secondary" type="button" disabled={busy} onClick={() => void resolveDiagnostic(item, 'skip')}>{item.entityType === 'actor' ? 'Keep legacy only' : 'Skip row'}</button>
              <button className="button button-secondary" type="button" disabled={busy} onClick={() => void resolveDiagnostic(item, 'defer')}>Defer</button>
            </div> : null}
          </div>)}</div> : <p className="mt-2 text-sm text-slate-600">No review items.</p>}
        </div>

        {['previewed', 'failed'].includes(details.run.status) ? <div className="mt-5 border-t border-slate-200 pt-4">
          <label className="form-label">Approval note<textarea className="form-control" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <p className="form-help">Keep the same workbook files selected above. The hashes must match this preview.</p>
          <div className="mt-3 flex justify-end"><button className="button button-primary" type="button" disabled={busy || openBlockers > 0 || (!adminFile && !userFile) || reason.trim().length < 8} onClick={() => void applyRun()}>Approve and apply</button></div>
        </div> : null}
      </section> : null}
    </div>
  );
}
