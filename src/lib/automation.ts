export const notificationSeverities = ['informational', 'attention', 'important'] as const;
export type NotificationSeverity = (typeof notificationSeverities)[number];

export const automationJobTypes = [
  'reverification_scan',
  'data_quality_scan',
  'duplicate_scan',
  'change_detection',
  'coverage_watch',
  'daily_digest',
  'weekly_digest',
] as const;
export type AutomationJobType = (typeof automationJobTypes)[number];

export type JobCounts = {
  processed: number;
  created: number;
  skipped: number;
  errors: number;
};

export const emptyJobCounts = (): JobCounts => ({ processed: 0, created: 0, skipped: 0, errors: 0 });

const dayMs = 86_400_000;

export function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * dayMs);
}

export function ageInDays(value: Date, now: Date): number {
  return Math.floor((now.getTime() - value.getTime()) / dayMs);
}

export type FacilityWorkDecision = {
  workType: 'reverification' | 'follow_up' | 'data_quality';
  priority: NotificationSeverity;
  dueAt: Date;
  reasonCodes: string[];
} | null;

type ContactOutcome =
  | 'verified'
  | 'no_answer'
  | 'voicemail_left'
  | 'voicemail_not_left'
  | 'disconnected'
  | 'wrong_number'
  | 'fax_only'
  | 'callback_requested'
  | 'unable_to_verify';

const followUpRules: Partial<Record<ContactOutcome, { days: number; priority: NotificationSeverity; workType: 'follow_up' | 'data_quality'; reason: string }>> = {
  callback_requested: { days: 1, priority: 'attention', workType: 'follow_up', reason: 'callback_requested' },
  no_answer: { days: 1, priority: 'informational', workType: 'follow_up', reason: 'no_answer' },
  voicemail_not_left: { days: 1, priority: 'informational', workType: 'follow_up', reason: 'voicemail_not_left' },
  voicemail_left: { days: 2, priority: 'informational', workType: 'follow_up', reason: 'voicemail_left' },
  unable_to_verify: { days: 3, priority: 'attention', workType: 'follow_up', reason: 'unable_to_verify' },
  fax_only: { days: 3, priority: 'informational', workType: 'follow_up', reason: 'fax_only' },
  disconnected: { days: 0, priority: 'important', workType: 'data_quality', reason: 'disconnected_number' },
  wrong_number: { days: 0, priority: 'important', workType: 'data_quality', reason: 'wrong_number' },
};

export function decideFailedContactWork(input: {
  attemptedAt: Date;
  outcome: ContactOutcome;
}): FacilityWorkDecision {
  const rule = followUpRules[input.outcome];
  if (!rule) return null;
  return {
    workType: rule.workType,
    priority: rule.priority,
    dueAt: addUtcDays(input.attemptedAt, rule.days),
    reasonCodes: [rule.reason],
  };
}

export function decideReverificationWork(input: {
  lastVerifiedAt: Date | null;
  now: Date;
  staleDays: number;
  upcomingDays: number;
  highPriority?: boolean;
}): FacilityWorkDecision {
  if (!input.lastVerifiedAt) {
    return {
      workType: 'reverification',
      priority: input.highPriority ? 'important' : 'attention',
      dueAt: input.now,
      reasonCodes: ['never_verified'],
    };
  }

  const dueAt = addUtcDays(input.lastVerifiedAt, input.staleDays);
  const daysUntilDue = Math.ceil((dueAt.getTime() - input.now.getTime()) / dayMs);
  if (daysUntilDue > input.upcomingDays) return null;
  if (daysUntilDue <= 0) {
    return {
      workType: 'reverification',
      priority: input.highPriority || daysUntilDue <= -30 ? 'important' : 'attention',
      dueAt,
      reasonCodes: ['stale'],
    };
  }
  return {
    workType: 'reverification',
    priority: 'informational',
    dueAt,
    reasonCodes: ['due_soon'],
  };
}

export type NormalizedChange = {
  eventType: string;
  severity: NotificationSeverity;
  beforeValue: unknown;
  afterValue: unknown;
};

function readState(state: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (key in state) return state[key];
  return undefined;
}

function changed(previous: unknown, next: unknown): boolean {
  return previous !== undefined && next !== undefined && previous !== next;
}

export function detectMeaningfulChanges(input: {
  previous: Record<string, unknown>;
  resulting: Record<string, unknown>;
  waitIncreaseDays: number;
  waitIncreasePercent: number;
  specialtyId?: string | null;
  diagnosisId?: string | null;
}): NormalizedChange[] {
  const output: NormalizedChange[] = [];
  const previousAccepting = readState(input.previous, 'acceptingStatus', 'currentAcceptingStatus');
  const nextAccepting = readState(input.resulting, 'acceptingStatus', 'currentAcceptingStatus');
  if (changed(previousAccepting, nextAccepting)) {
    if (previousAccepting === 'yes' && nextAccepting !== 'yes') {
      output.push({ eventType: 'stopped_accepting', severity: 'important', beforeValue: previousAccepting, afterValue: nextAccepting });
    } else if (previousAccepting !== 'yes' && nextAccepting === 'yes') {
      output.push({ eventType: 'started_accepting', severity: 'attention', beforeValue: previousAccepting, afterValue: nextAccepting });
    }
  }

  const pairs = [
    ['schedulingWithinFourWeeks', 'scheduling_changed'],
    ['urgentReferralStatus', 'urgent_referral_changed'],
  ] as const;
  for (const [key, eventType] of pairs) {
    const beforeValue = readState(input.previous, key);
    const afterValue = readState(input.resulting, key);
    if (changed(beforeValue, afterValue)) {
      output.push({ eventType, severity: 'attention', beforeValue, afterValue });
    }
  }

  const previousWait = Number(readState(input.previous, 'estimatedWaitDays'));
  const resultingWait = Number(readState(input.resulting, 'estimatedWaitDays'));
  if (Number.isFinite(previousWait) && previousWait >= 0 && Number.isFinite(resultingWait) && resultingWait > previousWait) {
    const increase = resultingWait - previousWait;
    const percent = previousWait === 0 ? 100 : (increase / previousWait) * 100;
    if (increase >= input.waitIncreaseDays && percent >= input.waitIncreasePercent) {
      output.push({
        eventType: 'wait_increased',
        severity: increase >= input.waitIncreaseDays * 2 ? 'important' : 'attention',
        beforeValue: previousWait,
        afterValue: resultingWait,
      });
    }
  }

  const previousSpecialty = readState(input.previous, 'specialtyStatus');
  const resultingSpecialty = readState(input.resulting, 'specialtyStatus');
  if (input.specialtyId && changed(previousSpecialty, resultingSpecialty)) {
    output.push({ eventType: 'specialty_changed', severity: 'attention', beforeValue: previousSpecialty, afterValue: resultingSpecialty });
  }

  const previousDiagnosis = readState(input.previous, 'diagnosisStatus');
  const resultingDiagnosis = readState(input.resulting, 'diagnosisStatus');
  if (input.diagnosisId && changed(previousDiagnosis, resultingDiagnosis)) {
    output.push({ eventType: 'diagnosis_changed', severity: 'attention', beforeValue: previousDiagnosis, afterValue: resultingDiagnosis });
  }
  return output;
}

export type CoverageTransition = {
  nextState: 'healthy' | 'alerting';
  nextCycle: number;
  event: 'opened' | 'resolved' | null;
};

export function evaluateCoverageTransition(input: {
  state: 'unknown' | 'healthy' | 'alerting';
  cycle: number;
  observedCount: number;
  minimumCount: number;
}): CoverageTransition {
  const below = input.observedCount < input.minimumCount;
  if (below && input.state !== 'alerting') {
    return { nextState: 'alerting', nextCycle: input.cycle + 1, event: 'opened' };
  }
  if (!below && input.state === 'alerting') {
    return { nextState: 'healthy', nextCycle: input.cycle, event: 'resolved' };
  }
  return { nextState: below ? 'alerting' : 'healthy', nextCycle: input.cycle, event: null };
}

export function severityMeetsMinimum(value: NotificationSeverity, minimum: NotificationSeverity): boolean {
  return notificationSeverities.indexOf(value) >= notificationSeverities.indexOf(minimum);
}
