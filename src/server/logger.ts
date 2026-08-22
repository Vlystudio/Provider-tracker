import { getReleaseIdentifier } from './release';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type ErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'database'
  | 'external_dependency'
  | 'rate_limit'
  | 'application'
  | 'unknown';

const sensitiveKeyPattern = /(authorization|cookie|password|passwd|secret|token|credential|database[_-]?url|connection[_-]?string|comment|notes?|email|member|diagnos|referral|phone|address|facility)/i;
const databaseUrlPattern = /postgres(?:ql)?:\/\/[^\s"']+/gi;
const bearerPattern = /bearer\s+[a-z0-9._~+/=-]+/gi;
const cookiePattern = /(?:session|auth|token|cookie)=[^;\s]+/gi;
const emailPattern = /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/gi;
const maxStringLength = 2_000;
const levelWeight: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL;
  return configured === 'debug' || configured === 'warn' || configured === 'error' ? configured : 'info';
}

function redactString(value: string): string {
  const bounded = value.length > maxStringLength ? `${value.slice(0, maxStringLength)}…` : value;
  return bounded
    .replace(databaseUrlPattern, '[REDACTED_DATABASE_URL]')
    .replace(bearerPattern, 'Bearer [REDACTED]')
    .replace(cookiePattern, '[REDACTED_COOKIE]')
    .replace(emailPattern, '[REDACTED_EMAIL]');
}

export function redactForLog(value: unknown, key = '', depth = 0): unknown {
  if (sensitiveKeyPattern.test(key)) return '[REDACTED]';
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (depth >= 6) return '[TRUNCATED]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactForLog(item, '', depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([entryKey, entryValue]) => [entryKey, redactForLog(entryValue, entryKey, depth + 1)]),
    );
  }
  return redactString(String(value));
}

export function classifyError(error: unknown): ErrorCategory {
  if (!error || typeof error !== 'object') return 'unknown';
  const candidate = error as { name?: string; status?: number; code?: string };
  if (candidate.status === 401 || /authenticat/i.test(candidate.name ?? '')) return 'authentication';
  if (candidate.status === 403 || /authoriz|forbidden/i.test(candidate.name ?? '')) return 'authorization';
  if (candidate.status === 429 || /rate.?limit/i.test(candidate.name ?? '')) return 'rate_limit';
  if (candidate.status === 400 || /validation|zod/i.test(candidate.name ?? '')) return 'validation';
  if (candidate.code?.startsWith('ECONN') || candidate.code?.startsWith('ETIMEDOUT')) return 'external_dependency';
  if (candidate.code?.match(/^[0-9A-Z]{5}$/) || /database|postgres|drizzle/i.test(candidate.name ?? '')) return 'database';
  if (error instanceof Error) return 'application';
  return 'unknown';
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (levelWeight[level] < levelWeight[currentLevel()]) return;
  const record = redactForLog({
    timestamp: new Date().toISOString(),
    level,
    event,
    release: getReleaseIdentifier(),
    ...fields,
  }) as Record<string, unknown>;
  const line = `${JSON.stringify(record)}\n`;
  (level === 'error' ? process.stderr : process.stdout).write(line);
}

export function safeErrorFields(error: unknown): Record<string, unknown> {
  const candidate = error instanceof Error ? error : new Error('Non-error value thrown');
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined;
  return {
    errorCategory: classifyError(error),
    errorName: candidate.name,
    errorMessage: candidate.message,
    ...(code ? { errorCode: code } : {}),
    ...(candidate.stack ? { stack: candidate.stack } : {}),
  };
}
