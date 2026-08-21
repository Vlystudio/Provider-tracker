import 'dotenv/config';

import { dueDailyRuns, formatLocalDate } from '../src/lib/automation-time';
import { automationSettingsSchema, defaultAutomationSettings } from '../src/lib/automation-config';
import { runAutomationJob } from '../src/server/automation-runner';
import { closeDatabasePool, getDatabasePool } from '../src/server/database';

const dailyJobs = ['reverification_scan', 'data_quality_scan', 'duplicate_scan', 'change_detection', 'coverage_watch', 'daily_digest'] as const;

async function commandSettings() {
  const result = await getDatabasePool()!.query('SELECT * FROM automation_settings WHERE scope=$1', ['global']);
  const row = result.rows[0];
  return row ? automationSettingsSchema.parse({
    timeZone: row.time_zone, upcomingStaleDays: row.upcoming_stale_days,
    meaningfulWaitIncreaseDays: row.meaningful_wait_increase_days,
    meaningfulWaitIncreasePercent: row.meaningful_wait_increase_percent,
    highPriorityEscalationDays: row.high_priority_escalation_days, dailyDigestHour: row.daily_digest_hour,
    weeklyDigestDay: row.weekly_digest_day, batchSize: row.batch_size,
  }) : defaultAutomationSettings;
}

async function lastSuccessfulDate(jobType: string, timeZone: string): Promise<string | null> {
  const result = await getDatabasePool()!.query<{ scheduled_for: Date }>(`
    SELECT scheduled_for FROM automation_job_executions
    WHERE job_type=$1 AND result IN ('succeeded','dry_run') AND trigger IN ('scheduled','recovery')
    ORDER BY scheduled_for DESC LIMIT 1`, [jobType]);
  return result.rows[0] ? formatLocalDate(result.rows[0].scheduled_for, timeZone) : null;
}

async function main() {
  const settings = await commandSettings();
  const now = new Date();
  const results = [];
  for (const jobType of dailyJobs) {
    const runs = dueDailyRuns({
      now,
      timeZone: settings.timeZone,
      hour: settings.dailyDigestHour,
      lastSuccessfulDate: await lastSuccessfulDate(jobType, settings.timeZone),
      maximumCatchUpDays: 3,
    });
    for (const run of runs) {
      results.push(await runAutomationJob(jobType, {
        executionKey: `scheduled:${jobType}:${run.dateKey}`,
        scheduledFor: run.scheduledFor,
        trigger: run.dateKey === formatLocalDate(now, settings.timeZone) ? 'scheduled' : 'recovery',
      }));
    }
  }
  process.stdout.write(`${JSON.stringify({ runs: results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Daily automation failed.'}\n`);
  process.exitCode = 1;
}).finally(closeDatabasePool);
