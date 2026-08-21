'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatDateTime, humanizeKey } from '@/lib/format';

type NotificationRow = {
  id: string;
  type: string;
  category: string;
  severity: 'informational' | 'attention' | 'important';
  title: string;
  message: string;
  targetPath: string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
};

type Preferences = {
  inAppEnabled: boolean;
  digestFrequency: 'none' | 'daily' | 'weekly';
  categories: string[];
  minimumSeverity: 'informational' | 'attention' | 'important';
};

const categories = ['work', 'changes', 'coverage', 'digest'] as const;

export function NotificationCenter({ initialRows, initialPreferences }: { initialRows: NotificationRow[]; initialPreferences: Preferences }) {
  const [rows, setRows] = useState(initialRows);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [message, setMessage] = useState('');

  async function markOne(id: string) {
    const response = await fetch(`/api/notifications/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) { setMessage('The notification could not be updated.'); return; }
    setRows((current) => current.map((row) => row.id === id ? { ...row, readAt: new Date().toISOString() } : row));
    setMessage('Notification marked as read.');
  }

  async function markAll() {
    const response = await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) { setMessage('Notifications could not be updated.'); return; }
    setRows((current) => current.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })));
    setMessage('All notifications marked as read.');
  }

  async function savePreferences(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/notification-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences),
    });
    setMessage(response.ok ? 'Notification preferences saved.' : 'Notification preferences could not be saved.');
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="table-shell" aria-labelledby="notification-list-heading">
        <div className="flex items-center justify-between gap-3 border-b border-slate-300 px-4 py-3">
          <h2 id="notification-list-heading" className="section-title">Recent notifications</h2>
          <button className="button button-secondary" type="button" onClick={markAll} disabled={!rows.some((row) => !row.readAt)}>Mark all read</button>
        </div>
        {rows.length ? (
          <ul className="divide-y divide-slate-200">
            {rows.map((row) => (
              <li key={row.id} className="p-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!row.readAt ? <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">Unread</span> : <span className="text-xs text-slate-500">Read</span>}
                      <span className="text-xs font-medium text-slate-600">{humanizeKey(row.category)} · {humanizeKey(row.severity)}</span>
                    </div>
                    <h3 className="mt-2 font-semibold text-slate-950">{row.title}</h3>
                    <p className="mt-1 text-sm text-slate-700">{row.message}</p>
                    <p className="mt-2 text-xs text-slate-500">{formatDateTime(row.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    {row.targetPath ? <Link className="button button-secondary" href={row.targetPath}>Open</Link> : null}
                    {!row.readAt ? <button className="button button-secondary" type="button" onClick={() => markOne(row.id)}>Mark read</button> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="p-5 text-sm text-slate-600">No notifications yet.</p>}
      </section>

      <form className="panel h-fit p-5" onSubmit={savePreferences}>
        <h2 className="section-title">Preferences</h2>
        <label className="mt-4 flex items-start gap-3 text-sm text-slate-800">
          <input type="checkbox" className="mt-1" checked={preferences.inAppEnabled} onChange={(event) => setPreferences({ ...preferences, inAppEnabled: event.target.checked })} />
          <span><strong className="block">In-app notifications</strong><span className="text-slate-600">Show alerts in Provider Tracker.</span></span>
        </label>
        <label className="form-label mt-4">Summary frequency
          <select className="form-control" value={preferences.digestFrequency} onChange={(event) => setPreferences({ ...preferences, digestFrequency: event.target.value as Preferences['digestFrequency'] })}>
            <option value="none">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
          </select>
        </label>
        <fieldset className="mt-4"><legend className="text-sm font-semibold text-slate-800">Categories</legend>
          <div className="mt-2 space-y-2">{categories.map((category) => <label key={category} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preferences.categories.includes(category)} onChange={(event) => setPreferences({ ...preferences, categories: event.target.checked ? [...preferences.categories, category] : preferences.categories.filter((item) => item !== category) })} />{humanizeKey(category)}</label>)}</div>
        </fieldset>
        <label className="form-label mt-4">Minimum severity
          <select className="form-control" value={preferences.minimumSeverity} onChange={(event) => setPreferences({ ...preferences, minimumSeverity: event.target.value as Preferences['minimumSeverity'] })}>
            <option value="informational">Informational</option><option value="attention">Attention</option><option value="important">Important</option>
          </select>
        </label>
        <button className="button button-primary mt-5" type="submit">Save preferences</button>
        <p className="mt-3 text-sm text-slate-600" role="status" aria-live="polite">{message}</p>
      </form>
    </div>
  );
}
