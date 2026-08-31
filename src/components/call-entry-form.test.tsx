// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallEntryForm } from './call-entry-form';

const firstFacilityId = '00000000-0000-4000-8000-000000000001';
const secondFacilityId = '00000000-0000-4000-8000-000000000002';
const lobId = '00000000-0000-4000-8000-000000000003';
const specialtyId = '00000000-0000-4000-8000-000000000004';
const diagnosisId = '00000000-0000-4000-8000-000000000005';

const options = {
  facilities: [
    { id: firstFacilityId, label: 'Alpha Clinic - Albany', phone: '555-0101' },
    { id: secondFacilityId, label: 'Beta Center - Buffalo', phone: '555-0102' },
  ],
  linesOfBusiness: [{ id: lobId, label: 'Commercial' }],
  specialties: [{ id: specialtyId, label: 'Cardiology' }],
  diagnoses: [{ id: diagnosisId, label: 'I10 - Hypertension' }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('call entry form', () => {
  it('generates and keeps one tracking ID while multiple facility calls are entered', async () => {
    const authorizationId = '00000000-0000-4000-8000-000000000006';
    const trackingId = `PT-${authorizationId}`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ call: { id: 'call-1', authorizationId, trackingId } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ call: { id: 'call-2', authorizationId, trackingId } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CallEntryForm {...options} />);

    const tracking = screen.getByLabelText(/^Tracking ID/);
    const facility = screen.getByLabelText(/^Facility name/);
    const phone = screen.getByLabelText('Phone used');
    const notes = screen.getByRole('textbox', { name: 'Notes' });

    fireEvent.change(screen.getByLabelText('Line of business'), { target: { value: lobId } });
    fireEvent.change(screen.getByLabelText('Specialty checked'), { target: { value: specialtyId } });
    fireEvent.change(screen.getByLabelText('Diagnosis checked'), { target: { value: diagnosisId } });
    fireEvent.change(facility, { target: { value: firstFacilityId } });
    fireEvent.change(notes, { target: { value: 'First call' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }));

    expect(await screen.findByText(`Alpha Clinic - Albany was saved under Tracking ID ${trackingId}.`)).toBeInTheDocument();
    expect(tracking).toHaveValue(trackingId);
    expect(tracking).toHaveAttribute('readonly');
    expect(facility).toHaveValue('');
    expect(phone).toHaveValue('');
    expect(notes).toHaveValue('');
    expect(screen.getByLabelText('Line of business')).toHaveValue(lobId);
    expect(screen.getByLabelText('Specialty checked')).toHaveValue(specialtyId);
    expect(screen.getByLabelText('Diagnosis checked')).toHaveValue(diagnosisId);
    expect(screen.getByText('1 call saved this session')).toBeInTheDocument();

    fireEvent.change(facility, { target: { value: secondFacilityId } });
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }));

    expect(await screen.findByText(`Beta Center - Buffalo was saved under Tracking ID ${trackingId}.`)).toBeInTheDocument();
    expect(screen.getByText('2 calls saved this session')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      const payloads = fetchMock.mock.calls.map(([, request]) => JSON.parse(String(request?.body)));
      expect(payloads.map((payload) => payload.authorizationId)).toEqual([null, authorizationId]);
      expect(payloads.map((payload) => payload.lobId)).toEqual([lobId, lobId]);
      expect(payloads.map((payload) => payload.specialtyId)).toEqual([specialtyId, specialtyId]);
      expect(payloads.map((payload) => payload.diagnosisId)).toEqual([diagnosisId, diagnosisId]);
    });
  });
});
