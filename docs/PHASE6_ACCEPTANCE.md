# Phase 6 acceptance

Date: 2026-08-21

Status: **COMPLETE WITH NON-BLOCKING INFRASTRUCTURE FOLLOW-UP**

The application work is complete. IT still needs to provide the production scheduler, PostgreSQL/PostGIS staging database, hosted monitoring, backups, and deployment approval.

## Automation

- Daily and weekly commands are scheduler-independent.
- Each run has a unique execution key and a PostgreSQL advisory lock by job type.
- Work, notifications, changes, coverage alert cycles, and digests also have database uniqueness rules.
- Transient failures are tried no more than three times. Permanent failures stop immediately.
- Runs record start, finish, result, counts, retries, release, and a bounded error summary.
- Missed daily runs recover the latest three local dates. Weekly recovery runs the latest missed period.
- Time calculations use the configured IANA time zone and include daylight-saving tests.
- Provider status, verified history, merges, staff accounts, and assignments remain human-controlled.

Database-backed acceptance: **14/14 passed**.

This covered stale-work creation and resolution, one notification per issue cycle, coverage open/quiet/resolve/reopen behavior, concurrent execution, a scan racing with interactive completion, concurrent notification insertion, digest retry, and persisted execution history.

Retry policy tests covered a transient deadlock followed by success and a permanent validation failure that stopped after one attempt.

## Notifications and access

Notifications are in-app only. User preferences cover in-app delivery, category, minimum severity, and digest frequency. Role checks run before insertion, and record/page permissions still apply when a user follows a link.

The expanded security matrix passed **60/60** scenarios. It includes notification ownership, notification IDOR, read-state changes, preferences, restricted targets, work-item ownership, administrator-only settings, manual dry runs, coverage watch creation, and automation health access.

## Performance

The automation benchmark used 10,000 temporary facilities and rolled back after the run.

| Operation | Rows | Time |
| --- | ---: | ---: |
| Stale scan | 7,704 | 20.2 ms |
| Quality scan | 800 | 2.9 ms |
| Duplicate detection | 9 pairs | 28.2 ms |
| Coverage watch evaluation | 718 | 0.8 ms |
| Digest generation | 5,335 | 1.4 ms |
| Notification generation | 1,000 | 2.6 ms |

All measured paths were below the 10-second acceptance limit. These are local query timings, not production service-level targets. The local database does not include PostGIS, so the separate staging geographic benchmark remains an IT gate.

The bounded HTTP check sent 100 requests at concurrency 10 with no network or server errors. The highest p95 was 218.1 ms on the sign-in page.

## Verification

- Unit/integration tests: **98/98 across 24 files**
- Automation acceptance: **14/14**
- Security matrix: **60/60**
- ESLint: passed with no warnings after cleanup
- TypeScript: passed
- Production build: passed
- Production dependency audit: zero vulnerabilities
- Secret scan: passed across 229 repository files and 24 commits before Phase 6 commits
- Local smoke: passed for entry, sign-in, liveness, readiness, anonymous API rejection, headers, request ID, and release identity
- Dependency failure: passed for liveness/readiness split, request correlation, credential redaction, protected metrics, and maintenance routing
- Isolated database restore: passed; Phase 6 tables were included in the row-count comparison
- Browser check: main dashboard, notifications, work, changes, coverage, and automation pages loaded without an application error overlay

## External follow-up

- Configure an approved cron, Kubernetes CronJob, Windows Task Scheduler task, or equivalent to call `npm run jobs:daily` and `npm run jobs:weekly`.
- Run migration preflight and the PostGIS spatial gate in staging.
- Repeat the PostGIS geographic benchmark and authenticated smoke suite in staging.
- Add an approved delivery provider only if the organization wants email later. No email controls or delivery claims exist now.
- Connect production logs, metrics, backups, and alerts to IT-owned services.
