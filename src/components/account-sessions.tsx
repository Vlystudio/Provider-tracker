'use client';

import { useState } from 'react';
import { InlineMessage } from './ui';

type AccountSession = {
  id: string;
  startedLabel: string;
  lastActiveLabel: string;
  current: boolean;
};

export function AccountSessions({ sessions }: { sessions: AccountSession[] }) {
  const [rows, setRows] = useState(sessions);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const otherSessions = rows.filter((row) => !row.current);

  async function revoke(path: string, key: string) {
    setPending(key);
    setError(null);
    const response = await fetch(path, { method: 'DELETE' });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setPending(null);
    if (!response.ok) {
      setError(body.error ?? 'The session was not signed out.');
      return;
    }
    setRows((current) => key === 'all' ? current.filter((row) => row.current) : current.filter((row) => row.id !== key));
  }

  return (
    <section className="panel max-w-2xl p-5" aria-labelledby="sessions-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sessions-heading" className="section-title">Signed-in sessions</h2>
          <p className="mt-1 text-sm text-slate-600">Review and sign out sessions tied to your account.</p>
        </div>
        {otherSessions.length ? (
          <button className="button button-secondary" type="button" disabled={pending !== null} onClick={() => revoke('/api/account/sessions', 'all')}>
            {pending === 'all' ? 'Signing out...' : 'Sign out other sessions'}
          </button>
        ) : null}
      </div>
      {error ? <div className="mt-4"><InlineMessage tone="error" role="alert">{error}</InlineMessage></div> : null}
      <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
        {rows.map((session) => (
          <div className="flex flex-wrap items-center justify-between gap-3 py-3" key={session.id}>
            <div className="text-sm">
              <p className="font-medium text-slate-900">{session.current ? 'Current session' : 'Other session'}</p>
              <p className="text-slate-600">Last active {session.lastActiveLabel}</p>
              <p className="text-xs text-slate-500">Started {session.startedLabel}</p>
            </div>
            {!session.current ? (
              <button className="button button-secondary" type="button" disabled={pending !== null} onClick={() => revoke(`/api/account/sessions/${encodeURIComponent(session.id)}`, session.id)}>
                {pending === session.id ? 'Signing out...' : 'Sign out'}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">If the sign-out control asks you to sign in again, your last authentication is more than 15 minutes old.</p>
    </section>
  );
}
