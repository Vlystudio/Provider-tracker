# Automation

Provider Tracker automation prepares work and reports changes. It does not change verified provider facts, merge records, assign work to a different person, or manage staff accounts.

## What runs automatically

| Workflow | Treatment | Result |
| --- | --- | --- |
| Stale, soon-to-expire, and never-verified availability | automatic | creates or updates work using the 30-day review date |
| Failed contacts | automatic preparation | creates follow-up or phone-data work using the contact outcome |
| Data quality | automatic detection | creates and resolves derived work; does not edit the provider record |
| Duplicate matching | automatic detection | creates candidate evidence and review work; never merges |
| Verified changes | automatic detection | writes a normalized change event after a threshold is met |
| Coverage watches | automatic read-only count | opens, resolves, or reopens an alert cycle |
| Daily and weekly summaries | automatic | stores a fixed summary for the period |
| Work assignment and dismissal | human controlled | an authorized user makes the change; the action is audited |
| Provider status, record merge, and user administration | manual only | existing protected workflows remain in charge |

Routine scans use job execution records instead of adding an audit row for every checked record. Manual runs, settings changes, assignments, and work-state changes are audited with the signed-in user. Automated records use a null human actor and a named source such as `reverification_scan`.

## Commands

Any scheduler that can run a command and supply the production environment can invoke the jobs:

```bash
npm run jobs:daily
npm run jobs:weekly
```

Run one job manually from a trusted shell:

```bash
npm run jobs:run -- --job reverification_scan --dry-run
npm run jobs:run -- --job data_quality_scan --execution-key manual-quality-2026-08-21
```

Available job names are `reverification_scan`, `data_quality_scan`, `duplicate_scan`, `change_detection`, `coverage_watch`, `daily_digest`, and `weekly_digest`.

The Automation page provides the same manual and dry-run controls to administrators. Dry runs record their execution but do not create work, notifications, changes, alerts, candidates, or summaries.

## Execution controls

Each run inserts one `automation_job_executions` row with a unique execution key. A repeated key returns the existing result. A PostgreSQL advisory lock allows only one active run of a given job type across all app instances. Database unique constraints provide a second layer of protection for work, notifications, changes, alerts, candidates, and summaries.

Transient database or network failures are tried at most three times with short increasing delays. Validation, permission, and constraint failures are not retried. Final failures are logged, recorded as failed, counted in metrics, and returned as a non-zero command result.

Work completed or dismissed by a user is reopened only when the underlying issue occurs again. Its cycle number increases, which permits one notification for the new cycle. Ongoing issues reuse the same work row and notification key.

## Schedule and missed runs

The organization time zone, daily hour, and weekly day are stored in Automation settings. Timestamps remain UTC in PostgreSQL. Daily period boundaries are calculated in the configured IANA time zone, including 23-hour and 25-hour daylight-saving days.

`jobs:daily` recovers at most the three most recent missing local dates and runs them oldest first. `jobs:weekly` runs the most recent missed weekly period. Stable keys prevent a recovered period from running twice. Older missed daily periods are not replayed automatically; an administrator can run a deliberate recovery after reviewing the likely notification volume.

The external scheduler should call `jobs:daily` after the configured daily hour and `jobs:weekly` after that hour on the configured weekday. Running the wrapper more than once is safe.

The Vercel deployment also invokes `/api/cron/reverification` every day at 12:00 UTC. Vercel supplies the production `CRON_SECRET` as a bearer token, and the route refuses to run when that secret is missing or invalid. Its date-based execution key makes a repeated request on the same UTC date safe.

## Rules

- Accepting and scheduling availability are current for 30 days when no more precise booking horizon is known.
- A confirmed next-available date takes precedence over the 30-day rule. A confirmed wait estimate is measured from the latest acceptance or scheduling verification. The facility stays out of default candidate results until that date is reached.
- When a facility is unavailable but the booking horizon cannot be confirmed, it is held for 30 days and then returned to the review queue for another call. Verification and call history are retained; the system never deletes data to refresh status.
- A wait increase is meaningful only when it meets both configured tests: absolute days and percentage. Defaults are 14 days and 50 percent.
- `callback_requested`, `no_answer`, and voicemail outcomes create follow-up work on different schedules. Disconnected and wrong numbers create data-quality work instead of another routine call.
- A coverage watch counts active, accepting facilities verified within its freshness limit and matching its specialty or diagnosis. Radius choices are limited to 10, 25, 50, or 100 miles.
- Coverage notifications are state based: healthy to alerting opens a cycle, an unchanged gap is quiet, recovery resolves the cycle, and a later gap starts a new cycle.
- A coverage gap that remains open for the configured escalation period produces one administrator escalation per cycle.
- Daily and weekly summaries store their period, release, recipient, generation time, execution, and section counts. Stored summaries do not change when current data changes.
- Summary counts do not calculate percentages. Existing reporting remains the source for metrics that require denominator rules.

## Metrics

The protected metrics endpoint includes fixed-label counters and timing values for job runs, failures, duration, generated notifications, notification failures, generated work, changes, duplicate candidates, digests, and coverage alerts. Coverage alert state is also exposed as a gauge. Job type and result are bounded labels; record and user IDs are never metric labels.

## Checks

Use a disposable database whose name ends in `_test`:

```bash
AUTOMATION_TEST_DATABASE_URL=postgresql://user:password@localhost/provider_tracker_test npm run test:automation
AUTOMATION_TEST_DATABASE_URL=postgresql://user:password@localhost/provider_tracker_test npm run test:automation-performance
```

The acceptance command removes its named fixtures. The performance command uses temporary tables and rolls back. The local coverage benchmark uses the same indexed filters without PostGIS distance calculation; the staging PostGIS benchmark remains required before deployment.

## Troubleshooting

1. Open Automation and find the most recent execution for the job.
2. Use the execution key, release, result, and error category to locate the structured log entry.
3. Check database readiness and pool waiting metrics.
4. Run a dry check with the same settings.
5. If the earlier execution is failed, use a new manual execution key after fixing the cause. Do not delete execution history to force a retry.

An execution marked `skipped` normally means another instance held the advisory lock or the same execution key had already been used. That is expected protection, not lost work.
