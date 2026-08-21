'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { automationJobTypes } from '@/lib/automation';
import { humanizeKey } from '@/lib/format';

type Settings = {
  timeZone: string;
  upcomingStaleDays: number;
  meaningfulWaitIncreaseDays: number;
  meaningfulWaitIncreasePercent: number;
  highPriorityEscalationDays: number;
  dailyDigestHour: number;
  weeklyDigestDay: number;
  batchSize: number;
};

export function AutomationControls({ initialSettings }: { initialSettings: Settings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [jobType, setJobType] = useState<(typeof automationJobTypes)[number]>('reverification_scan');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  async function runJob(dryRun: boolean) {
    setPending(true);
    const response = await fetch('/api/admin/automation/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobType, dryRun }),
    });
    const body = await response.json().catch(() => null);
    setPending(false);
    setMessage(response.ok ? `${humanizeKey(jobType)} ${dryRun ? 'dry run' : 'run'} finished. ${body.counts.processed} checked, ${body.counts.created} created.` : body?.error ?? 'The job failed.');
    router.refresh();
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const response = await fetch('/api/admin/automation/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    });
    setPending(false);
    setMessage(response.ok ? 'Automation settings saved.' : (await response.json().catch(() => null))?.error ?? 'Settings could not be saved.');
    router.refresh();
  }

  function numberField(label: string, key: keyof Settings, min: number, max: number) {
    return <label className="form-label">{label}<input className="form-control" type="number" min={min} max={max} value={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })} /></label>;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="panel p-5">
        <h2 className="section-title">Run a job</h2>
        <p className="mt-2 text-sm text-slate-600">Dry run checks the rules without writing work, notifications, changes, alerts, or summaries.</p>
        <label className="form-label mt-4">Job<select className="form-control" value={jobType} onChange={(event) => setJobType(event.target.value as typeof jobType)}>{automationJobTypes.map((item) => <option value={item} key={item}>{humanizeKey(item)}</option>)}</select></label>
        <div className="mt-4 flex flex-wrap gap-2"><button className="button button-primary" type="button" disabled={pending} onClick={() => runJob(true)}>Run dry check</button><button className="button button-secondary" type="button" disabled={pending} onClick={() => runJob(false)}>Run now</button></div>
      </section>
      <form className="panel p-5" onSubmit={saveSettings}>
        <h2 className="section-title">Rules and schedule</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="form-label">Time zone<input className="form-control" value={settings.timeZone} onChange={(event) => setSettings({ ...settings, timeZone: event.target.value })} /></label>
          {numberField('Upcoming stale days', 'upcomingStaleDays', 0, 30)}
          {numberField('Wait increase days', 'meaningfulWaitIncreaseDays', 1, 180)}
          {numberField('Wait increase percent', 'meaningfulWaitIncreasePercent', 1, 500)}
          {numberField('Escalation days', 'highPriorityEscalationDays', 1, 30)}
          {numberField('Daily run hour', 'dailyDigestHour', 0, 23)}
          {numberField('Weekly run day', 'weeklyDigestDay', 1, 7)}
          {numberField('Batch size', 'batchSize', 50, 2000)}
        </div>
        <button className="button button-primary mt-4" disabled={pending} type="submit">Save settings</button>
      </form>
      <p className="text-sm text-slate-700 xl:col-span-2" role="status" aria-live="polite">{message}</p>
    </div>
  );
}
