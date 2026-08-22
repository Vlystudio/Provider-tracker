'use client';

import { useState } from 'react';
import { InlineMessage } from './ui';

export function ProviderExportButton({ filters, maximumRows }: {
  filters: Record<string, string | number | undefined>;
  maximumRows: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/exports/providers.csv', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(filters),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'The export could not be created.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `provider-directory-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setConfirming(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The export could not be created.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel p-4" aria-labelledby="provider-export-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="provider-export-heading" className="section-title">Export these results</h2>
          <p className="mt-1 text-sm text-slate-600">CSV only. The current filters apply. The file is limited to {maximumRows.toLocaleString()} rows.</p>
        </div>
        {!confirming ? <button className="button button-secondary" type="button" onClick={() => setConfirming(true)}>Prepare export</button> : null}
      </div>
      {confirming ? <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">This file contains confidential operational data.</p><p className="mt-1">Keep it in an approved location and do not send it outside authorized channels.</p><div className="mt-3 flex gap-2"><button className="button button-primary" type="button" disabled={pending} onClick={download}>{pending ? 'Preparing…' : 'Download CSV'}</button><button className="button button-secondary" type="button" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button></div></div> : null}
      {error ? <div className="mt-3"><InlineMessage tone="error" role="alert">{error}</InlineMessage></div> : null}
    </section>
  );
}
