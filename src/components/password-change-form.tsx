'use client';

import { useState, type FormEvent } from 'react';
import { InlineMessage } from './ui';

export function PasswordChangeForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch('/api/account/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: String(data.get('currentPassword') ?? ''),
        newPassword: String(data.get('newPassword') ?? ''),
      }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setMessage({ tone: 'error', text: body.error ?? 'The password was not changed.' });
      return;
    }
    form.reset();
    setMessage({ tone: 'success', text: 'Password changed. Other sessions were signed out.' });
  }

  return (
    <section className="panel max-w-2xl p-5" aria-labelledby="password-heading">
      <h2 id="password-heading" className="section-title">Change password</h2>
      <p className="mt-1 text-sm text-slate-600">Use at least 15 characters. Password managers and pasted passwords are supported.</p>
      {message ? <div className="mt-4"><InlineMessage tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</InlineMessage></div> : null}
      <form className="mt-4 grid gap-4" onSubmit={submit}>
        <label className="form-label">
          Current password
          <input className="form-control" name="currentPassword" type="password" required maxLength={128} autoComplete="current-password" />
        </label>
        <label className="form-label">
          New password
          <input className="form-control" name="newPassword" type="password" required minLength={15} maxLength={128} autoComplete="new-password" />
        </label>
        <div><button className="button button-primary" type="submit" disabled={pending}>{pending ? 'Changing...' : 'Change password'}</button></div>
      </form>
    </section>
  );
}
