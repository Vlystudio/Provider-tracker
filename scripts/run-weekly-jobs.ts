import 'dotenv/config';

import { dueWeeklyRuns, formatLocalDate } from '../src/lib/automation-time';
import { automationSettingsSchema, defaultAutomationSettings } from '../src/lib/automation-config';
import { runAutomationJob } from '../src/server/automation-runner';
import { closeDatabasePool, getDatabasePool } from '../src/server/database';

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

async function main() {
  const settings = await commandSettings();
  const previous = await getDatabasePool()!.query<{ scheduled_for: Date }>(`
    SELECT scheduled_for FROM automation_job_executions
    WHERE job_type='weekly_digest' AND result='succeeded' AND trigger IN ('scheduled','recovery')
    ORDER BY scheduled_for DESC LIMIT 1`);
  const now = new Date();
  const runs = dueWeeklyRuns({
    now,
    timeZone: settings.timeZone,
    hour: settings.dailyDigestHour,
    weekday: settings.weeklyDigestDay,
    lastSuccessfulDate: previous.rows[0] ? formatLocalDate(previous.rows[0].scheduled_for, settings.timeZone) : null,
  });
  const results = [];
  for (const run of runs) {
    results.push(await runAutomationJob('weekly_digest', {
      executionKey: `scheduled:weekly_digest:${run.dateKey}`,
      scheduledFor: run.scheduledFor,
      trigger: run.dateKey === formatLocalDate(now, settings.timeZone) ? 'scheduled' : 'recovery',
    }));
  }
  process.stdout.write(`${JSON.stringify({ runs: results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Weekly automation failed.'}\n`);
  process.exitCode = 1;
}).finally(closeDatabasePool);
