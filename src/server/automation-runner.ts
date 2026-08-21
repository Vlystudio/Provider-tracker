import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { automationJobTypes, emptyJobCounts, type AutomationJobType, type JobCounts } from '@/lib/automation';
import { getDatabasePool } from './database';
import { notifyAutomationFailure, runAutomationHandler } from './automation-jobs';
import { classifyError, logEvent, safeErrorFields } from './logger';
import { incrementMetric, observeDuration } from './metrics';
import { getReleaseIdentifier } from './release';

const jobTypeSchema = z.enum(automationJobTypes);
const executionKeySchema = z.string().trim().min(4).max(160).regex(/^[a-zA-Z0-9:._+-]+$/);
const retryableCodes = new Set(['40001', '40P01', '57P03', '53300', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT']);

export type AutomationTrigger = 'scheduled' | 'manual' | 'recovery';
export type AutomationRunOptions = {
  executionKey?: string;
  trigger?: AutomationTrigger;
  scheduledFor?: Date;
  dryRun?: boolean;
  maximumAttempts?: number;
};

export type AutomationRunResult = {
  executionId: string;
  executionKey: string;
  jobType: AutomationJobType;
  result: 'succeeded' | 'failed' | 'skipped' | 'dry_run';
  counts: JobCounts;
  retryCount: number;
  deduplicated: boolean;
  metadata: Record<string, unknown>;
};

export function isRetryableAutomationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return retryableCodes.has(code);
}

export async function runWithBoundedRetry<T>(
  operation: () => Promise<T>,
  options: { maximumAttempts?: number; wait?: (milliseconds: number) => Promise<void> } = {},
): Promise<{ value: T; retryCount: number }> {
  const maximumAttempts = Math.max(1, Math.min(3, options.maximumAttempts ?? 3));
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let retryCount = 0;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return { value: await operation(), retryCount };
    } catch (error) {
      if (!isRetryableAutomationError(error) || attempt === maximumAttempts) throw Object.assign(error instanceof Error ? error : new Error('Automation failed.'), { retryCount });
      retryCount += 1;
      await wait(100 * 2 ** (attempt - 1));
    }
  }
  throw new Error('Automation retry limit was reached.');
}

async function insertExecution(client: PoolClient, input: {
  executionKey: string;
  jobType: AutomationJobType;
  trigger: AutomationTrigger;
  scheduledFor: Date;
}) {
  const result = await client.query<{ id: string }>(`
    INSERT INTO automation_job_executions
      (execution_key, job_type, trigger, scheduled_for, result, release_version)
    VALUES ($1, $2, $3, $4, 'running', $5)
    ON CONFLICT (execution_key) DO NOTHING
    RETURNING id`, [input.executionKey, input.jobType, input.trigger, input.scheduledFor, getReleaseIdentifier()]);
  return result.rows[0]?.id ?? null;
}

async function finishExecution(client: PoolClient, executionId: string, result: AutomationRunResult['result'], counts: JobCounts, retryCount: number, metadata: Record<string, unknown>, error?: unknown) {
  await client.query(`
    UPDATE automation_job_executions SET
      finished_at = now(), result = $2, processed_count = $3, created_count = $4,
      skipped_count = $5, error_count = $6, retry_count = $7, metadata = $8,
      error_category = $9, error_message = $10
    WHERE id = $1`, [
    executionId,
    result,
    counts.processed,
    counts.created,
    counts.skipped,
    counts.errors,
    retryCount,
    JSON.stringify(metadata),
    error ? classifyError(error) : null,
    error instanceof Error ? error.message.slice(0, 500) : null,
  ]);
}

export async function runAutomationJob(jobTypeValue: string, options: AutomationRunOptions = {}): Promise<AutomationRunResult> {
  const jobType = jobTypeSchema.parse(jobTypeValue);
  const scheduledFor = options.scheduledFor ?? new Date();
  const trigger = options.trigger ?? 'manual';
  const executionKey = executionKeySchema.parse(options.executionKey ?? `${trigger}:${jobType}:${randomUUID()}`);
  const pool = getDatabasePool();
  if (!pool) throw new Error('DATABASE_URL is required to run automation.');
  const client = await pool.connect();
  const started = performance.now();
  let executionId: string | null = null;
  let locked = false;
  try {
    executionId = await insertExecution(client, { executionKey, jobType, trigger, scheduledFor });
    if (!executionId) {
      const existing = await client.query<{ id: string; result: AutomationRunResult['result'] | 'running'; processed_count: number; created_count: number; skipped_count: number; error_count: number; retry_count: number; metadata: Record<string, unknown> }>(`
        SELECT id, result, processed_count, created_count, skipped_count, error_count, retry_count, metadata
        FROM automation_job_executions WHERE execution_key = $1`, [executionKey]);
      const row = existing.rows[0];
      return {
        executionId: row.id,
        executionKey,
        jobType,
        result: row.result === 'running' ? 'skipped' : row.result,
        counts: { processed: row.processed_count, created: row.created_count, skipped: row.skipped_count, errors: row.error_count },
        retryCount: row.retry_count,
        deduplicated: true,
        metadata: row.metadata ?? {},
      };
    }

    const lock = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [`provider-tracker:${jobType}`]);
    locked = lock.rows[0]?.acquired === true;
    if (!locked) {
      const counts = { ...emptyJobCounts(), skipped: 1 };
      await finishExecution(client, executionId, 'skipped', counts, 0, { reason: 'job_already_running' });
      return { executionId, executionKey, jobType, result: 'skipped', counts, retryCount: 0, deduplicated: false, metadata: { reason: 'job_already_running' } };
    }

    const { value, retryCount } = await runWithBoundedRetry(
      () => runAutomationHandler(jobType, { client, executionId: executionId!, executionKey, scheduledFor, dryRun: options.dryRun === true }),
      { maximumAttempts: options.maximumAttempts },
    );
    const result = options.dryRun ? 'dry_run' : 'succeeded';
    await finishExecution(client, executionId, result, value.counts, retryCount, value.metadata);
    incrementMetric('provider_tracker_automation_jobs_total', { operation: jobType, result });
    logEvent('info', 'automation.job-finished', { executionId, executionKey, jobType, result, retryCount, ...value.counts });
    return { executionId, executionKey, jobType, result, counts: value.counts, retryCount, deduplicated: false, metadata: value.metadata };
  } catch (error) {
    const retryCount = typeof error === 'object' && error && 'retryCount' in error ? Number(error.retryCount) : 0;
    const counts = { ...emptyJobCounts(), errors: 1 };
    if (executionId) {
      await finishExecution(client, executionId, 'failed', counts, retryCount, {}, error).catch(() => undefined);
      await notifyAutomationFailure(client, executionId, jobType).catch(() => undefined);
    }
    incrementMetric('provider_tracker_automation_jobs_total', { operation: jobType, result: 'failed' });
    logEvent('error', 'automation.job-failed', { executionId, executionKey, jobType, retryCount, ...safeErrorFields(error) });
    throw error;
  } finally {
    observeDuration('provider_tracker_automation_job_duration_ms', performance.now() - started, { operation: jobType });
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`provider-tracker:${jobType}`]).catch(() => undefined);
    client.release();
  }
}
