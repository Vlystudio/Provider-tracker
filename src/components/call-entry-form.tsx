'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { InlineMessage } from './ui';

type Option = { id: string; label: string; phone?: string | null };

type CallEntryFormProps = {
  facilities: Option[];
  specialties: Option[];
  diagnoses: Option[];
  linesOfBusiness: Option[];
};

function localDateTime() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.valueOf() - offset).toISOString().slice(0, 16);
}

const availabilityOptions = [
  ['unknown', 'Unknown'],
  ['yes', 'Yes'],
  ['no', 'No'],
  ['not_applicable', 'Not applicable'],
] as const;

export function CallEntryForm({ facilities, specialties, diagnoses, linesOfBusiness }: CallEntryFormProps) {
  const router = useRouter();
  const [facilityQuery, setFacilityQuery] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [phone, setPhone] = useState('');
  const [contactOutcome, setContactOutcome] = useState('reached');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const filteredFacilities = useMemo(() => {
    const query = facilityQuery.trim().toLowerCase();
    const matches = query
      ? facilities.filter((facility) => facility.label.toLowerCase().includes(query))
      : facilities;
    return matches.slice(0, 75);
  }, [facilities, facilityQuery]);

  function chooseFacility(id: string) {
    setFacilityId(id);
    const facility = facilities.find((item) => item.id === id);
    setPhone(facility?.phone ?? '');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!facilityId) {
      setMessage('Choose a facility before saving the call.');
      return;
    }

    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? '').trim();
    const callAt = new Date(field('callAt'));
    if (Number.isNaN(callAt.valueOf())) {
      setMessage('Enter a valid call date and time.');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          callAt: callAt.toISOString(),
          facilityId,
          authorizationNumber: field('authorizationNumber') || null,
          lobId: field('lobId') || null,
          specialtyId: field('specialtyId') || null,
          diagnosisId: field('diagnosisId') || null,
          phone: field('phone') || null,
          contactOutcome,
          acceptingNewPatients: contactOutcome === 'reached' ? field('acceptingNewPatients') : 'unknown',
          canTreatDiagnosis: contactOutcome === 'reached' ? field('canTreatDiagnosis') : 'unknown',
          canScheduleWithinFourWeeks: contactOutcome === 'reached' ? field('canScheduleWithinFourWeeks') : 'unknown',
          specialtyConfirmed: contactOutcome === 'reached' ? field('specialtyConfirmed') : 'unknown',
          notes: field('notes') || null,
        }),
      });
      const body = await response.json().catch(() => null) as { call?: { id: string }; error?: string } | null;
      if (!response.ok || !body?.call) {
        setMessage(body?.error ?? 'The call could not be saved.');
        return;
      }
      router.push('/call-log?saved=1');
      router.refresh();
    } catch {
      setMessage('The call could not be saved. Check the connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {message ? <InlineMessage tone="error" role="alert">{message}</InlineMessage> : null}

      <section className="panel p-5" aria-labelledby="call-details-heading">
        <h2 id="call-details-heading" className="section-title">Call details</h2>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <label className="form-label">
            Call date and time
            <input className="form-control" name="callAt" type="datetime-local" defaultValue={localDateTime()} required />
          </label>
          <label className="form-label">
            Authorization number
            <input className="form-control" name="authorizationNumber" maxLength={100} autoComplete="off" />
          </label>
          <label className="form-label">
            Line of business
            <select className="form-control" name="lobId" defaultValue="">
              <option value="">Not recorded</option>
              {linesOfBusiness.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="panel p-5" aria-labelledby="facility-heading">
        <h2 id="facility-heading" className="section-title">Facility</h2>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(20rem,1fr)_minmax(20rem,1fr)]">
          <div className="space-y-3">
            <label className="form-label">
              Find a facility
              <input
                className="form-control"
                type="search"
                value={facilityQuery}
                onChange={(event) => setFacilityQuery(event.target.value)}
                placeholder="Type a facility name or city"
                autoComplete="off"
              />
            </label>
            <label className="form-label">
              Facility name
              <select
                className="form-control min-h-40"
                name="facilityId"
                size={Math.min(8, Math.max(2, filteredFacilities.length))}
                value={facilityId}
                onChange={(event) => chooseFacility(event.target.value)}
                required
              >
                <option value="" disabled>{filteredFacilities.length ? 'Choose a facility' : 'No facilities found'}</option>
                {filteredFacilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.label}</option>)}
              </select>
              <span className="form-help">Showing up to 75 matches.</span>
            </label>
          </div>
          <div className="grid content-start gap-4">
            <label className="form-label">
              Phone used
              <input className="form-control" name="phone" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} />
            </label>
            <label className="form-label">
              Specialty checked
              <select className="form-control" name="specialtyId" defaultValue="">
                <option value="">Not recorded</option>
                {specialties.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="form-label">
              Diagnosis checked
              <select className="form-control" name="diagnosisId" defaultValue="">
                <option value="">Not recorded</option>
                {diagnoses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="panel p-5" aria-labelledby="result-heading">
        <h2 id="result-heading" className="section-title">Call result</h2>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <label className="form-label">
            Contact outcome
            <select className="form-control" name="contactOutcome" value={contactOutcome} onChange={(event) => setContactOutcome(event.target.value)}>
              <option value="reached">Reached facility</option>
              <option value="no_answer">No answer</option>
              <option value="voicemail_left">Voicemail left</option>
              <option value="voicemail_not_left">Voicemail not left</option>
              <option value="disconnected">Disconnected number</option>
              <option value="wrong_number">Wrong number</option>
              <option value="fax_only">Fax line only</option>
              <option value="callback_requested">Callback requested</option>
              <option value="unable_to_verify">Unable to verify</option>
            </select>
          </label>
          {contactOutcome === 'reached' ? (
            <>
              <label className="form-label">
                Accepting new patients
                <select className="form-control" name="acceptingNewPatients" defaultValue="unknown">
                  {availabilityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="form-label">
                Specialty confirmed
                <select className="form-control" name="specialtyConfirmed" defaultValue="unknown">
                  {availabilityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="form-label">
                Can treat diagnosis
                <select className="form-control" name="canTreatDiagnosis" defaultValue="unknown">
                  <option value="unknown">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="unable_to_tell_without_triage">Needs triage</option>
                  <option value="not_applicable">Not applicable</option>
                </select>
              </label>
              <label className="form-label">
                Can schedule within four weeks
                <select className="form-control" name="canScheduleWithinFourWeeks" defaultValue="unknown">
                  <option value="unknown">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="urgent_referral_required">Yes, urgent referral required</option>
                  <option value="unable_to_tell_without_triage">Needs triage</option>
                  <option value="not_applicable">Not applicable</option>
                </select>
                <span className="form-help">Records the provider requirement only. Provider Tracker does not create or submit referrals.</span>
              </label>
            </>
          ) : null}
        </div>
      </section>

      <section className="panel p-5" aria-labelledby="notes-heading">
        <h2 id="notes-heading" className="section-title">Notes</h2>
        <label className="form-label mt-4">
          Notes
          <textarea className="form-control min-h-28" name="notes" maxLength={2000} />
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button className="button button-primary" type="submit" disabled={saving || !facilities.length}>
          {saving ? 'Saving…' : 'Save call'}
        </button>
        <Link className="button button-secondary" href="/call-log">Cancel</Link>
      </div>
    </form>
  );
}
