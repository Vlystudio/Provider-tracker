import 'server-only';

import { sql } from 'drizzle-orm';
import { authRateLimits } from '@/db/schema';
import { hashAuditValue } from './audit';
import { requireDatabaseClient } from './database';

export class RateLimitExceededError extends Error {
  readonly status = 429;
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests.');
  }
}

export async function enforceDatabaseRateLimit(
  subject: string,
  action: string,
  options: { max: number; windowSeconds: number },
): Promise<void> {
  const now = Date.now();
  const windowStart = now - options.windowSeconds * 1000;
  const key = hashAuditValue(`${action}:${subject}`);
  const db = requireDatabaseClient();

  const [row] = await db
    .insert(authRateLimits)
    .values({ key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        count: sql<number>`case when ${authRateLimits.lastRequest} < ${windowStart} then 1 else ${authRateLimits.count} + 1 end`,
        lastRequest: sql<number>`case when ${authRateLimits.lastRequest} < ${windowStart} then ${now} else ${authRateLimits.lastRequest} end`,
      },
    })
    .returning({ count: authRateLimits.count, lastRequest: authRateLimits.lastRequest });

  if (row && row.count > options.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((row.lastRequest + options.windowSeconds * 1000 - now) / 1000));
    throw new RateLimitExceededError(retryAfterSeconds);
  }
}

export function rateLimitErrorResponse(error: unknown): Response | null {
  if (!(error instanceof RateLimitExceededError)) return null;
  return Response.json(
    { error: 'Too many requests. Try again later.' },
    { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
  );
}
