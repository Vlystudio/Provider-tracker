'use client';

import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';

export function ThemeToggle() {
  const [saving, setSaving] = useState(false);

  async function toggleTheme() {
    const previous = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const nextTheme = previous === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    setSaving(true);
    try {
      const response = await fetch('/api/ui-preferences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme: nextTheme }),
      });
      if (!response.ok) throw new Error('Preference update failed.');
    } catch {
      document.documentElement.dataset.theme = previous;
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      aria-label="Toggle light or dark mode"
      title="Toggle light or dark mode"
      disabled={saving}
      onClick={toggleTheme}
    >
      <span className="theme-icon-light"><Moon aria-hidden="true" size={18} /></span>
      <span className="theme-icon-dark"><Sun aria-hidden="true" size={18} /></span>
    </button>
  );
}
