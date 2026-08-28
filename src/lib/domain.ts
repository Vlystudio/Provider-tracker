export type ResultCode =
  | 'unable_to_contact'
  | 'does_not_meet_availability_guidelines'
  | 'meets_availability_guidelines'
  | 'meets_availability_guidelines_urgent';

export type Recommendation =
  | 'Call - previous attempt unable to contact / did not leave voicemail'
  | 'Do not call - provider not accepting new patients'
  | 'Call - provider accepting status unknown'
  | 'Do not call - provider cannot schedule within 4 weeks'
  | 'Provider good to call - verify if they treat diagnosis'
  | 'Call - provider availability not confirmed'
  | '';

export type ResultInput = {
  didNotLeaveVm: boolean;
  accepting?: string | null;
  canTreat?: string | null;
  schedule?: string | null;
};

export function normalizeAlias(value: string): string {
  const cleaned = value
    .replace(/\u00A0|Â\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*/g, ' | ')
    .trim();

  const normalized = cleaned.toLowerCase();

  if (normalized === 'unkown' || normalized === 'unknown') return 'Unknown';
  if (normalized === 'na' || normalized === 'n/a') return 'N/A';
  if (normalized === 'did not leave vm') return 'did_not_leave_vm';
  if (normalized === 'yes can schedule w/in 4 weeks with urgent referral' || normalized === 'yes can schedule within 4 weeks with urgent referral') return 'Urgent referral required';
  if (normalized === 'unable to tell w/out triage') return 'Unable to tell without triage';
  if (normalized === 'brunsw ick') return 'Brunswick';

  return cleaned;
}

export function compactDateToDate(input: string): Date | undefined {
  if (!input) return undefined;
  const compact = input.replace(/[^0-9]/g, '');
  if (/^\d{8}$/.test(compact)) {
    const month = Number(compact.slice(0, 2));
    const day = Number(compact.slice(2, 4));
    const year = Number(compact.slice(4, 8));
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function isPositiveYes(value?: string | null): boolean {
  if (!value) return false;
  const normalized = normalizeAlias(value).toLowerCase();
  return normalized === 'yes' || normalized === 'yes can schedule w/in 4 weeks with urgent referral' || normalized === 'urgent referral required';
}

export function getResultCode(input: ResultInput): ResultCode {
  if (input.didNotLeaveVm) return 'unable_to_contact';
  if (!isPositiveYes(input.accepting)) return 'does_not_meet_availability_guidelines';
  if (!isPositiveYes(input.canTreat)) return 'does_not_meet_availability_guidelines';
  if (input.schedule && normalizeAlias(input.schedule).toLowerCase().includes('urgent')) return 'meets_availability_guidelines_urgent';
  if (isPositiveYes(input.schedule)) return 'meets_availability_guidelines';
  return 'does_not_meet_availability_guidelines';
}

export function getResultPhrase(input: ResultInput): string {
  const code = getResultCode(input);

  switch (code) {
    case 'unable_to_contact':
      return 'unable to contact, did not leave voicemail';
    case 'meets_availability_guidelines_urgent':
      return 'meets availability guidelines - urgent referral required for scheduling';
    case 'meets_availability_guidelines':
      return 'meets availability guidelines';
    default:
      return 'does not meet availability guidelines';
  }
}

export function getSevenDayRecommendation(input: {
  facility?: string | null;
  didNotLeaveVm?: boolean;
  accepting?: string | null;
  schedule?: string | null;
}): Recommendation {
  if (!input.facility) return '';
  if (input.didNotLeaveVm) return 'Call - previous attempt unable to contact / did not leave voicemail';

  const accepting = input.accepting ?? '';
  const schedule = input.schedule ?? '';
  const acceptingStatus = normalizeAlias(accepting).toLowerCase();
  const scheduleStatus = normalizeAlias(schedule).toLowerCase();

  if (acceptingStatus === 'yes' && (scheduleStatus === 'yes' || scheduleStatus.includes('urgent'))) {
    return 'Provider good to call - verify if they treat diagnosis';
  }

  if (acceptingStatus === 'yes' && scheduleStatus !== 'yes' && !scheduleStatus.includes('urgent')) {
    return 'Do not call - provider cannot schedule within 4 weeks';
  }

  if (acceptingStatus === 'no') {
    return 'Do not call - provider not accepting new patients';
  }

  if (acceptingStatus === 'unknown') {
    return 'Call - provider accepting status unknown';
  }

  if (input.didNotLeaveVm === false && acceptingStatus !== 'yes') {
    return 'Call - provider availability not confirmed';
  }

  return 'Call - provider availability not confirmed';
}

export function getAuthorizationNarrative({
  calls,
  authorizationNumber,
  diagnosis,
  specialty,
}: {
  calls: Array<{ id: string; provider: string; phone: string; resultCode: string; success: boolean }>;
  authorizationNumber: string;
  diagnosis: string;
  specialty: string;
}): string {
  const successfulCalls = calls.filter((call) => call.success);
  const included = successfulCalls.length > 1 ? successfulCalls.slice(0, 2) : calls;

  const lines = [
    `Authorization ${authorizationNumber}`,
    `Diagnosis: ${diagnosis}`,
    `Specialty: ${specialty}`,
    `Provider list:`,
    ...included.map((call, index) => `${index + 1}. ${call.provider} (${call.phone}) - ${call.resultCode}`),
  ];

  if (successfulCalls.length > 2) {
    lines.push('Stopped after the second successful provider because the summary intentionally caps successful provider list entries.');
  }

  return lines.join('\n');
}

export function providerSearchValidation(input: {
  memberZip: string;
  radius: number;
  diagnosis?: string;
  specialty?: string;
}) {
  const z = {
    memberZip: input.memberZip?.trim(),
    radius: input.radius,
    diagnosis: input.diagnosis?.trim(),
    specialty: input.specialty?.trim(),
  };

  const hasDiagnosis = Boolean(z.diagnosis);
  const hasSpecialty = Boolean(z.specialty);

  if (!z.memberZip || z.memberZip.length < 5) {
    return { success: false, error: 'A valid member ZIP code is required.' };
  }

  if (!Number.isFinite(z.radius) || z.radius <= 0) {
    return { success: false, error: 'Radius must be a positive number.' };
  }

  if (hasDiagnosis && hasSpecialty) {
    return { success: false, error: 'Choose either diagnosis or specialty, not both.' };
  }

  if (!hasDiagnosis && !hasSpecialty) {
    return { success: false, error: 'Choose either a diagnosis or a specialty.' };
  }

  return { success: true };
}
