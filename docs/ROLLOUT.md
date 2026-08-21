# Rollout plan

## Audience

- URA staff: provider search, call entry, review queue, and work inbox.
- Supervisors: reports, changes, coverage, and operational follow-up.
- Administrators: user access, data quality, duplicate review, automation, and migration.
- IT: database migrations, environment configuration, backup, restore, monitoring, and incident response.

## Training

Use the staging site with the UAT data set. Keep sessions task-based: find a provider, record a call, correct a provider, complete work, read a report, and review a migration issue. Administrators need a separate cutover and rollback session. Give staff the support contact and the exact information to include with a problem: time, page, authorization or facility ID, and what they expected.

## Release sequence

1. Deploy to staging and complete technical acceptance.
2. Complete business UAT and close release-blocking defects.
3. Rehearse cutover and restore with named operators.
4. Freeze and hash the source workbooks.
5. Follow [CUTOVER.md](CUTOVER.md).
6. Use a limited support window after launch with IT and operations present.
7. Review the first daily and weekly reports with the business owner.

## First-day checks

- sign-in failures and permission errors;
- health and readiness endpoints;
- database connections, latency, locks, and storage;
- migration reconciliation and audit events;
- provider searches, call writes, and report totals;
- automation executions, new work, notifications, and failure alerts;
- support tickets grouped by workflow.

## First-week checks

Review duplicate candidates, data-quality work, stale-provider work, report denominator changes, notification volume, and any manual corrections to migrated values. Remove the increased support coverage only after the operations owner agrees that volumes and totals are stable.

## Rollback communication

If the release is rolled back, tell users when writes stopped, which data window is affected, whether entries must be repeated, and when the previous release is available. Do not announce that all data is safe until the restored row counts and smoke tests are complete.
