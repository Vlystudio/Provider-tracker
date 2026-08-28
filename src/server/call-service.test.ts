import { describe, expect, it } from 'vitest';
import { callEntryInputSchema } from './call-service';

const facilityId = '00000000-0000-4000-8000-000000000001';

function validCall() {
  return {
    callAt: new Date().toISOString(),
    facilityId,
    authorizationNumber: ' auth-123 ',
    contactOutcome: 'reached',
    acceptingNewPatients: 'yes',
    canTreatDiagnosis: 'yes',
    canScheduleWithinFourWeeks: 'yes',
    specialtyConfirmed: 'yes',
  };
}

describe('call entry validation', () => {
  it('normalizes the authorization number and applies safe defaults', () => {
    const parsed = callEntryInputSchema.parse(validCall());
    expect(parsed.authorizationNumber).toBe('AUTH-123');
    expect(parsed.useInFdm).toBe(false);
  });

  it('accepts a controlled failed-contact outcome', () => {
    const parsed = callEntryInputSchema.parse({
      callAt: new Date().toISOString(),
      facilityId,
      contactOutcome: 'voicemail_left',
    });
    expect(parsed.contactOutcome).toBe('voicemail_left');
  });

  it('rejects future calls, bad identifiers, and unsupported fields', () => {
    expect(() => callEntryInputSchema.parse({ ...validCall(), callAt: new Date(Date.now() + 86_400_000).toISOString() })).toThrow();
    expect(() => callEntryInputSchema.parse({ ...validCall(), facilityId: 'not-an-id' })).toThrow();
    expect(() => callEntryInputSchema.parse({ ...validCall(), callerUserId: facilityId })).toThrow();
  });
});
