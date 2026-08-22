export type HousekeepingExecutionPolicy = {
  batchSize: number;
};

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Housekeeping value must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function resolveHousekeepingExecutionPolicy(
  source: Record<string, string | undefined> = process.env,
): HousekeepingExecutionPolicy {
  return {
    batchSize: boundedInteger(source.HOUSEKEEPING_BATCH_SIZE, 1_000, 1, 10_000),
  };
}

export function retentionCutoff(now: Date, retentionDays: number): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36_500) {
    throw new Error('Retention days must be between 1 and 36500.');
  }
  return new Date(now.getTime() - retentionDays * 86_400_000);
}
