'use client';

import { useEffect, useRef, useState } from 'react';
import { InlineMessage } from './ui';

export type AuthorizationView = {
  id: string;
  authorizationNumber: string;
  memberZip: string | null;
  status: 'open' | 'complete' | 'cancelled';
  referralReasonDetail: string | null;
  updatedAt: string;
};

export function AuthorizationEditor({ record, editable }: { record: AuthorizationView; editable: boolean }) {
  const [current, setCurrent] = useState(record);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [zipError, setZipError] = useState('');
  const messageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setZipError('');
    const form = new FormData(event.currentTarget);
    const memberZip = String(form.get('memberZip') ?? '').trim();

    if (memberZip && !/^\d{5}$/.test(memberZip)) {
      setZipError('Enter a five-digit ZIP code or leave this field blank.');
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/authorizations/${current.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: String(form.get('status') ?? 'open'),
          memberZip: memberZip || null,
          referralReasonDetail: String(form.get('referralReasonDetail') ?? '').trim() || null,
        }),
      });
      const body = await response.json().catch(() => ({})) as { authorization?: AuthorizationView; error?: string };
      if (!response.ok || !body.authorization) {
        setMessage({ tone: 'error', text: body.error ?? 'The authorization could not be saved.' });
        return;
      }

      setCurrent({ ...body.authorization, updatedAt: new Date(body.authorization.updatedAt).toISOString() });
      setMessage({ tone: 'success', text: `${current.authorizationNumber} was saved.` });
    } catch {
      setMessage({ tone: 'error', text: 'The authorization could not be saved. Check the connection and try again.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {message ? (
        <div ref={messageRef} tabIndex={-1}>
          <InlineMessage tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>
            {message.text}
          </InlineMessage>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="form-label">
          Status
          <select className="form-control" name="status" value={current.status} disabled={!editable || pending} onChange={(event) => setCurrent({ ...current, status: event.target.value as AuthorizationView['status'] })}>
            <option value="open">Open</option>
            <option value="complete">Complete</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="form-label">
          Member ZIP
          <input
            className="form-control"
            name="memberZip"
            inputMode="numeric"
            maxLength={5}
            value={current.memberZip ?? ''}
            disabled={!editable || pending}
            aria-invalid={Boolean(zipError)}
            aria-describedby={zipError ? 'authorization-zip-error' : undefined}
            onChange={(event) => setCurrent({ ...current, memberZip: event.target.value })}
          />
          {zipError ? <span id="authorization-zip-error" className="form-error">{zipError}</span> : null}
        </label>
      </div>

      <label className="form-label">
        Referral notes
        <textarea
          className="form-control min-h-28"
          name="referralReasonDetail"
          maxLength={1000}
          value={current.referralReasonDetail ?? ''}
          disabled={!editable || pending}
          onChange={(event) => setCurrent({ ...current, referralReasonDetail: event.target.value })}
        />
        <span className="form-help">Use operational notes only. Do not enter passwords or account credentials.</span>
      </label>

      {editable ? (
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      ) : (
        <p className="text-sm text-slate-600">This role can view authorization details but cannot change them.</p>
      )}
    </form>
  );
}
