'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Option = { id: string; label: string };

export function CoverageWatchForm({ specialties, diagnoses }: { specialties: Option[]; diagnoses: Option[] }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const values = new FormData(event.currentTarget);
    const response = await fetch('/api/admin/coverage-watches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.get('name'),
        specialtyId: values.get('specialtyId') || null,
        diagnosisId: values.get('diagnosisId') || null,
        postalCode: values.get('postalCode'),
        radiusMiles: Number(values.get('radiusMiles')),
        minimumCount: Number(values.get('minimumCount')),
        freshnessDays: Number(values.get('freshnessDays')),
        enabled: true,
      }),
    });
    setPending(false);
    if (!response.ok) { setMessage((await response.json().catch(() => null))?.error ?? 'Coverage watch could not be saved.'); return; }
    event.currentTarget.reset();
    setMessage('Coverage watch saved. It will be evaluated by the next coverage job.');
    router.refresh();
  }

  return (
    <form className="panel p-5" onSubmit={submit}>
      <h2 className="section-title">Add a watch</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="form-label">Name<input required className="form-control" name="name" maxLength={100} placeholder="Oncology near Portland" /></label>
        <label className="form-label">Specialty<select className="form-control" name="specialtyId"><option value="">Any specialty</option>{specialties.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="form-label">Diagnosis<select className="form-control" name="diagnosisId"><option value="">Any diagnosis</option>{diagnoses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="form-label">ZIP<input required className="form-control" name="postalCode" pattern="[0-9]{5}(-[0-9]{4})?" inputMode="numeric" /></label>
        <label className="form-label">Radius<select className="form-control" name="radiusMiles" defaultValue="50"><option value="10">10 miles</option><option value="25">25 miles</option><option value="50">50 miles</option><option value="100">100 miles</option></select></label>
        <label className="form-label">Minimum verified options<input required className="form-control" type="number" name="minimumCount" min="1" max="100" defaultValue="2" /></label>
        <label className="form-label">Freshness limit<input required className="form-control" type="number" name="freshnessDays" min="1" max="365" defaultValue="45" /></label>
      </div>
      <div className="mt-4 flex items-center gap-3"><button disabled={pending} className="button button-primary" type="submit">{pending ? 'Saving…' : 'Save watch'}</button><p className="text-sm text-slate-600" role="status" aria-live="polite">{message}</p></div>
    </form>
  );
}
