'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { InlineMessage } from './ui';

type Option = { id: string; label: string };

const answers = [
  ['', 'Not checked'],
  ['yes', 'Yes'],
  ['no', 'No'],
  ['unknown', 'Unknown'],
  ['not_asked', 'Not asked'],
  ['unable_to_verify', 'Unable to verify'],
  ['not_applicable', 'Not applicable'],
] as const;

function localDateTime() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.valueOf() - offset).toISOString().slice(0, 16);
}

async function responseMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? (response.ok ? 'Saved.' : 'The request could not be completed.');
}

export function FacilityActions({
  facilityId,
  version,
  specialties,
  diagnoses,
}: {
  facilityId: string;
  version: number;
  specialties: Option[];
  diagnoses: Option[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<'verification' | 'contact' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function saveVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('verification');
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? '').trim();
    const specialtyId = field('specialtyId');
    const diagnosisId = field('diagnosisId');
    const body = {
      expectedVersion: version,
      verifiedAt: new Date(field('verifiedAt')).toISOString(),
      method: field('method'),
      confidence: field('confidence'),
      contactPerson: field('contactPerson') || null,
      contactChannel: field('contactChannel') || null,
      ...(field('acceptingStatus') ? { acceptingStatus: field('acceptingStatus') } : {}),
      ...(specialtyId && field('specialtyStatus') ? { specialtyId, specialtyStatus: field('specialtyStatus') } : {}),
      ...(diagnosisId && field('diagnosisStatus') ? { diagnosisId, diagnosisStatus: field('diagnosisStatus') } : {}),
      ...(field('schedulingWithinFourWeeks') ? { schedulingWithinFourWeeks: field('schedulingWithinFourWeeks') } : {}),
      ...(field('urgentReferralStatus') ? { urgentReferralStatus: field('urgentReferralStatus') } : {}),
      ...(field('nextAvailableDate') ? { nextAvailableDate: field('nextAvailableDate') } : {}),
      ...(field('estimatedWaitDays') ? { estimatedWaitDays: Number(field('estimatedWaitDays')) } : {}),
      comments: field('comments') || null,
    };
    try {
      const response = await fetch(`/api/facilities/${facilityId}/verifications`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      setMessage({ tone: response.ok ? 'success' : 'error', text: await responseMessage(response) });
      if (response.ok) {
        event.currentTarget.reset();
        router.refresh();
      }
    } catch {
      setMessage({ tone: 'error', text: 'The verification could not be saved.' });
    } finally {
      setSaving(null);
    }
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('contact');
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? '').trim();
    try {
      const response = await fetch(`/api/facilities/${facilityId}/contact-attempts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attemptedAt: new Date(field('attemptedAt')).toISOString(),
          method: field('method'),
          outcome: field('outcome'),
          contactPerson: field('contactPerson') || null,
          contactChannel: field('contactChannel') || null,
          comments: field('comments') || null,
        }),
      });
      setMessage({ tone: response.ok ? 'success' : 'error', text: await responseMessage(response) });
      if (response.ok) {
        event.currentTarget.reset();
        router.refresh();
      }
    } catch {
      setMessage({ tone: 'error', text: 'The contact attempt could not be saved.' });
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="facility-work-heading">
      <div><h2 id="facility-work-heading" className="section-title">Record activity</h2><p className="mt-1 text-sm text-slate-600">Save confirmed facts as a verification. Save an unsuccessful call as a contact attempt.</p></div>
      {message ? <InlineMessage tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</InlineMessage> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <form className="panel space-y-4 p-4" onSubmit={saveVerification}>
          <div><h3 className="font-semibold text-slate-950">Verification</h3><p className="mt-1 text-xs text-slate-500">Only fields selected below are changed.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="form-label">Verified at<input className="form-control" name="verifiedAt" type="datetime-local" defaultValue={localDateTime()} required /></label>
            <label className="form-label">Method<select className="form-control" name="method" defaultValue="phone"><option value="phone">Phone</option><option value="fax">Fax</option><option value="portal">Portal</option><option value="website">Website</option><option value="email">Email</option><option value="internal_source">Internal source</option><option value="other">Other</option></select></label>
            <label className="form-label">Source confidence<select className="form-control" name="confidence" defaultValue="direct"><option value="direct">Direct contact</option><option value="authoritative">Authoritative source</option><option value="secondary">Secondary source</option><option value="unverified">Unverified source</option></select></label>
            <label className="form-label">Accepting<select className="form-control" name="acceptingStatus" defaultValue="">{answers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="form-label">Scheduling within four weeks<select className="form-control" name="schedulingWithinFourWeeks" defaultValue="">{answers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="form-label">Urgent referral required<select className="form-control" name="urgentReferralStatus" defaultValue="">{answers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="form-label">Next available date<input className="form-control" name="nextAvailableDate" type="date" /></label>
            <label className="form-label">Estimated wait (days)<input className="form-control" name="estimatedWaitDays" type="number" min={0} max={3650} /></label>
            <label className="form-label">Specialty<select className="form-control" name="specialtyId" defaultValue=""><option value="">Not checked</option>{specialties.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="form-label">Specialty result<select className="form-control" name="specialtyStatus" defaultValue="">{answers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="form-label">Diagnosis<select className="form-control" name="diagnosisId" defaultValue=""><option value="">Not checked</option>{diagnoses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="form-label">Diagnosis result<select className="form-control" name="diagnosisStatus" defaultValue="">{answers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="form-label">Contact person<input className="form-control" name="contactPerson" maxLength={200} /></label>
            <label className="form-label">Contact channel<input className="form-control" name="contactChannel" maxLength={200} placeholder="Phone extension or email" /></label>
          </div>
          <label className="form-label">Comments<textarea className="form-control min-h-24" name="comments" maxLength={2000} /></label>
          <button className="button button-primary" type="submit" disabled={saving !== null}>{saving === 'verification' ? 'Saving…' : 'Save verification'}</button>
        </form>

        <form className="panel h-fit space-y-4 p-4" onSubmit={saveContact}>
          <div><h3 className="font-semibold text-slate-950">Contact attempt</h3><p className="mt-1 text-xs text-slate-500">This does not change verification freshness.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="form-label">Attempted at<input className="form-control" name="attemptedAt" type="datetime-local" defaultValue={localDateTime()} required /></label>
            <label className="form-label">Method<select className="form-control" name="method" defaultValue="phone"><option value="phone">Phone</option><option value="fax">Fax</option><option value="portal">Portal</option><option value="website">Website</option><option value="email">Email</option><option value="other">Other</option></select></label>
            <label className="form-label">Outcome<select className="form-control" name="outcome" defaultValue="no_answer"><option value="no_answer">No answer</option><option value="voicemail_left">Voicemail left</option><option value="voicemail_not_left">Voicemail not left</option><option value="disconnected">Disconnected</option><option value="wrong_number">Wrong number</option><option value="fax_only">Fax only</option><option value="callback_requested">Callback requested</option><option value="unable_to_verify">Unable to verify</option></select></label>
            <label className="form-label">Contact person<input className="form-control" name="contactPerson" maxLength={200} /></label>
            <label className="form-label">Contact channel<input className="form-control" name="contactChannel" maxLength={200} /></label>
          </div>
          <label className="form-label">Comments<textarea className="form-control min-h-24" name="comments" maxLength={2000} /></label>
          <button className="button button-secondary" type="submit" disabled={saving !== null}>{saving === 'contact' ? 'Saving…' : 'Save contact attempt'}</button>
        </form>
      </div>
    </section>
  );
}
