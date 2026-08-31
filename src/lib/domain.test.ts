import { describe, expect, it } from 'vitest';
import {
  compactDateToDate,
  getResultCode,
  getResultPhrase,
  getSevenDayRecommendation,
  getTrackingNarrative,
  normalizeAlias,
  providerSearchValidation,
} from './domain';

describe('normalization and aliases', () => {
  it('normalizes common workbook aliases', () => {
    expect(normalizeAlias('Unkown')).toBe('Unknown');
    expect(normalizeAlias('NA')).toBe('N/A');
    expect(normalizeAlias('Did not leave VM')).toBe('did_not_leave_vm');
    expect(normalizeAlias('  Brunsw ick  ')).toBe('Brunswick');
  });
});

describe('compact date parsing', () => {
  it('parses compact dates in the configured timezone', () => {
    const value = compactDateToDate('04272026');
    expect(value).toBeDefined();
    expect(value?.getFullYear()).toBe(2026);
    expect(value?.getMonth()).toBe(3);
    expect(value?.getDate()).toBe(27);
  });
});

describe('result phrase rules', () => {
  it('did not leave VM overrides other statuses', () => {
    expect(getResultCode({ didNotLeaveVm: true, accepting: 'Yes', canTreat: 'Yes', schedule: 'Yes' })).toBe('unable_to_contact');
    expect(getResultPhrase({ didNotLeaveVm: true, accepting: 'Yes', canTreat: 'Yes', schedule: 'Yes' })).toBe('unable to contact, did not leave voicemail');
  });

  it('accepting no fails even when treat/schedule are yes', () => {
    expect(getResultCode({ didNotLeaveVm: false, accepting: 'No', canTreat: 'Yes', schedule: 'Yes' })).toBe('does_not_meet_availability_guidelines');
  });

  it('can treat no fails even when accepting/schedule are yes', () => {
    expect(getResultCode({ didNotLeaveVm: false, accepting: 'Yes', canTreat: 'No', schedule: 'Yes' })).toBe('does_not_meet_availability_guidelines');
  });

  it('urgent referral scheduling yields urgent success phrase', () => {
    expect(getResultPhrase({ didNotLeaveVm: false, accepting: 'Yes', canTreat: 'Yes', schedule: 'Urgent referral required' })).toBe('meets availability guidelines - urgent referral required for scheduling');
  });

  it('ordinary yes scheduling yields ordinary success', () => {
    expect(getResultPhrase({ didNotLeaveVm: false, accepting: 'Yes', canTreat: 'Yes', schedule: 'Yes' })).toBe('meets availability guidelines');
  });
});

describe('seven-day recommendation', () => {
  it('uses the workbook decision rules', () => {
    expect(getSevenDayRecommendation({ facility: 'Test', didNotLeaveVm: true })).toBe('Call - previous attempt unable to contact / did not leave voicemail');
    expect(getSevenDayRecommendation({ facility: 'Test', didNotLeaveVm: false, accepting: 'No' })).toBe('Do not call - provider not accepting new patients');
    expect(getSevenDayRecommendation({ facility: 'Test', didNotLeaveVm: false, accepting: 'Unknown' })).toBe('Call - provider accepting status unknown');
  });
});

describe('tracking narrative stop-after-second-success', () => {
  it('stops after the second successful call and includes the relevant calls', () => {
    const calls = [
      { id: '1', provider: 'Alpha', phone: '111', resultCode: 'meets_availability_guidelines', success: true },
      { id: '2', provider: 'Beta', phone: '222', resultCode: 'meets_availability_guidelines', success: true },
      { id: '3', provider: 'Gamma', phone: '333', resultCode: 'meets_availability_guidelines', success: true },
    ];

    const narrative = getTrackingNarrative({
      calls,
      trackingId: 'PT-00000000-0000-4000-8000-000000000001',
      diagnosis: 'J45',
      specialty: 'Pulmonology',
    });

    expect(narrative.includes('Alpha')).toBe(true);
    expect(narrative.includes('Beta')).toBe(true);
    expect(narrative.includes('Gamma')).toBe(false);
    expect(narrative).toContain('second successful provider');
  });
});

describe('provider search validation', () => {
  it('requires a member zip and exactly one of diagnosis or specialty', () => {
    expect(providerSearchValidation({ memberZip: '04530', radius: 50, diagnosis: 'J45' }).success).toBe(true);
    expect(providerSearchValidation({ memberZip: '04530', radius: 50, specialty: 'Cardiology' }).success).toBe(true);
    expect(providerSearchValidation({ memberZip: '04530', radius: 50, diagnosis: 'J45', specialty: 'Cardiology' }).success).toBe(false);
    expect(providerSearchValidation({ memberZip: '', radius: 50, diagnosis: 'J45' }).success).toBe(false);
  });
});
