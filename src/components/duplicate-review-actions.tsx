'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { InlineMessage } from './ui';

type FacilitySide = { id: string; name: string; version: number };

async function message(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? (response.ok ? 'Saved.' : 'The request could not be completed.');
}

export function DuplicateRefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'saving'>('idle');
  const [feedback, setFeedback] = useState<string | null>(null);
  async function refresh() {
    setState('saving'); setFeedback(null);
    const response = await fetch('/api/admin/duplicates/refresh', { method: 'POST' }).catch(() => null);
    setFeedback(response ? await message(response) : 'The candidate scan could not be run.');
    setState('idle');
    if (response?.ok) router.refresh();
  }
  return <div className="flex flex-wrap items-center gap-3"><button type="button" className="button button-secondary" onClick={refresh} disabled={state === 'saving'}>{state === 'saving' ? 'Scanning…' : 'Scan for duplicates'}</button>{feedback ? <span role="status" className="text-sm text-slate-600">{feedback}</span> : null}</div>;
}

export function DuplicateReviewActions({ candidateId, left, right }: { candidateId: string; left: FacilitySide; right: FacilitySide }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function decision(decisionValue: 'not_duplicate' | 'deferred') {
    const note = window.prompt(decisionValue === 'not_duplicate' ? 'Why are these separate facilities?' : 'Why is review being deferred?');
    if (!note?.trim()) return;
    setSaving(true); setFeedback(null);
    const response = await fetch(`/api/admin/duplicates/${candidateId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: decisionValue, note }),
    }).catch(() => null);
    setFeedback({ tone: response?.ok ? 'success' : 'error', text: response ? await message(response) : 'The decision could not be saved.' });
    setSaving(false);
    if (response?.ok) router.refresh();
  }

  async function merge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const survivorId = String(data.get('survivor'));
    const merged = survivorId === left.id ? right : left;
    const survivor = survivorId === left.id ? left : right;
    const confirmation = String(data.get('confirmation') ?? '').trim();
    if (confirmation !== 'MERGE') {
      setFeedback({ tone: 'error', text: 'Type MERGE to confirm.' });
      return;
    }
    setSaving(true); setFeedback(null);
    const response = await fetch('/api/admin/facilities/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        survivorFacilityId: survivor.id,
        mergedFacilityId: merged.id,
        candidateId,
        reason: String(data.get('reason') ?? ''),
        survivorExpectedVersion: survivor.version,
        mergedExpectedVersion: merged.version,
        confirmation,
      }),
    }).catch(() => null);
    setFeedback({ tone: response?.ok ? 'success' : 'error', text: response ? await message(response) : 'The facilities could not be merged.' });
    setSaving(false);
    if (response?.ok) router.refresh();
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      {feedback ? <div className="mb-3"><InlineMessage tone={feedback.tone} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.text}</InlineMessage></div> : null}
      <div className="flex flex-wrap gap-2"><button className="button button-secondary" type="button" onClick={() => decision('not_duplicate')} disabled={saving}>Not duplicate</button><button className="button button-secondary" type="button" onClick={() => decision('deferred')} disabled={saving}>Defer</button></div>
      <details className="mt-4 rounded border border-red-200 bg-red-50 p-3">
        <summary className="cursor-pointer font-semibold text-red-950">Merge facilities</summary>
        <form className="mt-3 space-y-3" onSubmit={merge}>
          <p className="text-sm text-red-900">The other record will be archived. History stays available and relationships are copied to the surviving record.</p>
          <label className="form-label">Keep this record<select name="survivor" className="form-control" defaultValue={left.id}><option value={left.id}>{left.name}</option><option value={right.id}>{right.name}</option></select></label>
          <label className="form-label">Reason<textarea name="reason" className="form-control min-h-20" minLength={5} maxLength={500} required /></label>
          <label className="form-label">Type MERGE to confirm<input name="confirmation" className="form-control" autoComplete="off" required /></label>
          <button className="button bg-red-700 text-white hover:bg-red-800" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Merge records'}</button>
        </form>
      </details>
    </div>
  );
}
