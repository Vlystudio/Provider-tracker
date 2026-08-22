import type { UserRole } from './access-control';

export const accessReviewDecisionValues = ['retain', 'modify', 'disable', 'investigate'] as const;
export type AccessReviewDecision = (typeof accessReviewDecisionValues)[number];

export const retentionCategories = [
  { key: 'expired_sessions', table: 'sessions', dateColumn: 'expires_at', purpose: 'Expired authentication sessions' },
  { key: 'expired_verification_tokens', table: 'verification_tokens', dateColumn: 'expires_at', purpose: 'Expired verification and reset tokens' },
  { key: 'inactive_rate_limit_buckets', table: 'auth_rate_limits', dateColumn: 'last_request', purpose: 'Inactive authentication rate-limit buckets' },
] as const;

export type RetentionCategory = (typeof retentionCategories)[number]['key'];

export function isRetentionCategory(value: string): value is RetentionCategory {
  return retentionCategories.some((category) => category.key === value);
}

export function currentReviewPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

export function isDormantAccount(
  input: { active: boolean; lastSignedInAt: Date | string | null; createdAt: Date | string },
  dormantDays: number,
  now = new Date(),
): boolean {
  if (!input.active) return false;
  const activity = input.lastSignedInAt ? new Date(input.lastSignedInAt) : new Date(input.createdAt);
  return now.getTime() - activity.getTime() >= dormantDays * 86_400_000;
}

export function canExportProviderDirectory(role: UserRole): boolean {
  return role === 'admin' || role === 'ura_user';
}

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function safeFilterKeys(input: Record<string, unknown>): string[] {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key]) => key)
    .sort();
}
