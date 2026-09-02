'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DashboardModePreference } from '@/lib/ui-preferences';

export function DashboardViewToggle({ initialMode }: { initialMode: DashboardModePreference }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [saving, setSaving] = useState(false);

  async function toggleMode() {
    const nextMode = mode === 'simple' ? 'detailed' : 'simple';
    const previous = mode;
    setMode(nextMode);
    setSaving(true);
    try {
      const response = await fetch('/api/ui-preferences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dashboardMode: nextMode }),
      });
      if (!response.ok) throw new Error('Preference update failed.');
      router.refresh();
    } catch {
      setMode(previous);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={mode === 'detailed'}
      disabled={saving}
      onClick={toggleMode}
      className="button button-secondary min-w-36"
    >
      {mode === 'simple' ? 'Simple dashboard' : 'Detailed dashboard'}
    </button>
  );
}
