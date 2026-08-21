'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function WorkItemActions({ id, status, expectedVersion }: { id: string; status: string; expectedVersion: number }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  async function update(nextStatus: 'in_progress' | 'completed' | 'blocked') {
    setPending(true);
    const reason = nextStatus === 'blocked' ? window.prompt('Why is this work blocked?')?.trim() : undefined;
    if (nextStatus === 'blocked' && !reason) { setPending(false); return; }
    const response = await fetch(`/api/work-items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus, expectedVersion, ...(reason ? { reason } : {}) }),
    });
    setPending(false);
    if (!response.ok) { setMessage((await response.json().catch(() => null))?.error ?? 'The work item could not be updated.'); return; }
    setMessage('Work item updated.');
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status !== 'in_progress' ? <button type="button" className="button-link" disabled={pending} onClick={() => update('in_progress')}>Start</button> : null}
        <button type="button" className="button-link" disabled={pending} onClick={() => update('completed')}>Complete</button>
        <button type="button" className="button-link" disabled={pending} onClick={() => update('blocked')}>Block</button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{message}</span>
    </div>
  );
}
