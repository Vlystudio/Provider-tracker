export type HousekeepingPolicy = {
  sessionRetentionDays: number;
  verificationTokenRetentionDays: number;
  rateLimitRetentionHours: number;
  batchSize: number;
};

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Housekeeping value must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function resolveHousekeepingPolicy(source: Record<string, string | undefined> = process.env): HousekeepingPolicy {
  return {
    sessionRetentionDays: boundedInteger(source.SESSION_EXPIRED_RETENTION_DAYS, 7, 0, 365),
    verificationTokenRetentionDays: boundedInteger(source.VERIFICATION_TOKEN_RETENTION_DAYS, 7, 0, 90),
    rateLimitRetentionHours: boundedInteger(source.RATE_LIMIT_RETENTION_HOURS, 24, 1, 720),
    batchSize: boundedInteger(source.HOUSEKEEPING_BATCH_SIZE, 1_000, 1, 10_000),
  };
}

export function housekeepingCutoffs(now: Date, policy: HousekeepingPolicy) {
  return {
    sessionsBefore: new Date(now.getTime() - policy.sessionRetentionDays * 86_400_000),
    tokensBefore: new Date(now.getTime() - policy.verificationTokenRetentionDays * 86_400_000),
    rateLimitsBeforeEpochMs: now.getTime() - policy.rateLimitRetentionHours * 3_600_000,
  };
}
