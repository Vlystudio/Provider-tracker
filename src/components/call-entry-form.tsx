'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, type FormEvent } from 'react';
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
  const formRef = useRef<HTMLFormElement>(null);
  const facilitySearchRef = useRef<HTMLInputElement>(null);
  const [callAt, setCallAt] = useState(localDateTime);
  const [authorizationId, setAuthorizationId] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [lobId, setLobId] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [diagnosisId, setDiagnosisId] = useState('');
  const [facilityQuery, setFacilityQuery] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [phone, setPhone] = useState('');
  const [contactOutcome, setContactOutcome] = useState('reached');
  const [savedCallCount, setSavedCallCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'success' | 'warning' | 'error'; text: string } | null>(null);
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

  function resetCallFields(form: HTMLFormElement) {
    form.reset();
    setCallAt(localDateTime());
    setFacilityQuery('');
    setFacilityId('');
    setPhone('');
    setContactOutcome('reached');
    window.setTimeout(() => facilitySearchRef.current?.focus(), 0);
  }

  function startNewTrackingRecord() {
    const form = formRef.current;
    if (form) form.reset();
    setCallAt(localDateTime());
    setAuthorizationId(null);
    setTrackingId(null);
    setLobId('');
    setSpecialtyId('');
    setDiagnosisId('');
    setFacilityQuery('');
    setFacilityId('');
    setPhone('');
    setContactOutcome('reached');
    setSavedCallCount(0);
    setMessage({ tone: 'info', text: 'Ready for a new tracking record.' });
    window.setTimeout(() => facilitySearchRef.current?.focus(), 0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!facilityId) {
      setMessage({ tone: 'error', text: 'Choose a facility before saving the call.' });
      return;
    }

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const field = (name: string) => String(form.get(name) ?? '').trim();
    const callDate = new Date(callAt);
    if (Number.isNaN(callDate.valueOf())) {
      setMessage({ tone: 'error', text: 'Enter a valid call date and time.' });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          callAt: callDate.toISOString(),
          facilityId,
          authorizationId,
          lobId: lobId || null,
          specialtyId: specialtyId || null,
          diagnosisId: diagnosisId || null,
          phone: field('phone') || null,
          contactOutcome,
          acceptingNewPatients: contactOutcome === 'reached' ? field('acceptingNewPatients') : 'unknown',
          canTreatDiagnosis: contactOutcome === 'reached' ? field('canTreatDiagnosis') : 'unknown',
          canScheduleWithinFourWeeks: contactOutcome === 'reached' ? field('canScheduleWithinFourWeeks') : 'unknown',
          specialtyConfirmed: contactOutcome === 'reached' ? field('specialtyConfirmed') : 'unknown',
          notes: field('notes') || null,
        }),
      });
      const body = await response.json().catch(() => null) as {
        call?: { id: string; duplicate?: boolean; authorizationId: string; trackingId: string };
        error?: string;
      } | null;
      if (!response.ok || !body?.call) {
        setMessage({ tone: 'error', text: body?.error ?? 'The call could not be saved.' });
        return;
      }
      const selectedFacility = facilities.find((facility) => facility.id === facilityId)?.label ?? 'Facility call';
      setAuthorizationId(body.call.authorizationId);
      setTrackingId(body.call.trackingId);
      if (body.call.duplicate) {
        setMessage({ tone: 'warning', text: `${selectedFacility} was already in the call log. Tracking ID ${body.call.trackingId} is still selected.` });
      } else {
        setSavedCallCount((count) => count + 1);
        setMessage({ tone: 'success', text: `${selectedFacility} was saved under Tracking ID ${body.call.trackingId}.` });
      }
      resetCallFields(formElement);
    } catch {
      setMessage({ tone: 'error', text: 'The call could not be saved. Check the connection and try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} className="space-y-5" onSubmit={submit}>
      {message ? <InlineMessage tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</InlineMessage> : null}

      <section className="panel p-5" aria-labelledby="call-details-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="call-details-heading" className="section-title">Tracking and call time</h2>
            <p className="mt-1 text-sm text-slate-600">A unique Tracking ID is created automatically and stays selected while you record facility calls.</p>
          </div>
          {trackingId ? (
            <div className="flex flex-wrap items-center gap-3">
              {savedCallCount ? (
                <p className="text-sm font-semibold text-slate-700" role="status">
                  {savedCallCount} {savedCallCount === 1 ? 'call' : 'calls'} saved this session
                </p>
              ) : null}
              <button className="button button-secondary" type="button" disabled={saving} onClick={startNewTrackingRecord}>
                Start new tracking record
              </button>
            </div>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <label className="form-label">
            Call date and time
            <input className="form-control" name="callAt" type="datetime-local" value={callAt} onChange={(event) => setCallAt(event.target.value)} required />
          </label>
          <label className="form-label">
            Tracking ID
            <input
              className="form-control"
              value={trackingId ?? 'Generated after the first call is saved'}
              readOnly
            />
            <span className="form-help">
              {savedCallCount ? 'This ID groups the calls saved in the current session.' : 'No member or payer identifier is required.'}
            </span>
          </label>
          <label className="form-label">
            Line of business
            <select className="form-control" name="lobId" value={lobId} onChange={(event) => setLobId(event.target.value)}>
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
                ref={facilitySearchRef}
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
              <select className="form-control" name="specialtyId" value={specialtyId} onChange={(event) => setSpecialtyId(event.target.value)}>
                <option value="">Not recorded</option>
                {specialties.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="form-label">
              Diagnosis checked
              <select className="form-control" name="diagnosisId" value={diagnosisId} onChange={(event) => setDiagnosisId(event.target.value)}>
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

      <div className="flex flex-wrap items-center gap-3">
        <button className="button button-primary" type="submit" disabled={saving || !facilities.length}>
          {saving ? 'Saving…' : 'Save call'}
        </button>
        <Link className="button button-secondary" href="/call-log">
          {savedCallCount ? 'Finish and view call log' : 'Cancel'}
        </Link>
      </div>
    </form>
  );
}
