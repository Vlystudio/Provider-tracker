# Cutover runbook

## Owners

Name one person for each role before scheduling the cutover: cutover lead, database operator, migration reviewer, application operator, operations approver, security contact, and rollback decision owner.

## Seven days before

- Confirm the staging release and database migration are the same versions planned for production.
- Run the final staging preview against copies of the expected source workbooks.
- Finish the UAT checklist in [UAT.md](UAT.md).
- Run `npm run verify:release`, `npm run test:migration`, `npm run test:migration-performance`, and `npm run test:restore`.
- Time a complete backup, preview, apply, reconciliation, smoke test, and restore rehearsal.
- Agree on the workbook freeze time, outage notice, support contact, and rollback deadline.

## One day before

- Confirm database capacity, backup storage, monitoring, and operator access.
- Confirm there are no open blocking migration diagnostics.
- Save the approved run ID, source filenames, SHA-256 hashes, sizes, schema version, release, row counts, and approver in the cutover record.
- Verify that the source workbooks contain four-digit years and have been recalculated and saved.
- Stop nonessential data changes that could make the final preview stale.

## Cutover steps

1. Announce the start and put the application in the agreed maintenance or read-only state.
2. Stop scheduled automation jobs.
3. Record database row counts and create the named cutover backup. Save its checksum outside the application host.
4. Upload the frozen workbooks and run a new production preview.
5. Compare hashes and counts with the approved cutover record. A difference requires review; do not assume it is harmless.
6. Resolve all blocking items and get the named operations approver’s decision.
7. Apply the run once. Do not start a second apply while it is running.
8. Confirm the run is reconciled and inspect calls, facilities, relationships, legacy actors, answer-state totals, and report denominators.
9. Run production smoke tests for sign-in, provider search, facility history, call log, reports, migration history, audit, and health endpoints.
10. Start automation in dry-run mode. Confirm baseline work is created without a notification flood, then return jobs to the approved schedule.
11. Record GO or NO-GO and the evidence used.

## GO criteria

- Backup and restore rehearsal passed.
- Source hashes and schema version match the reviewed files.
- No open or deferred error diagnostic remains.
- Reconciliation is 100 percent and report parity matches.
- No newer verified application value was overwritten.
- Smoke tests pass and error rates remain normal.
- Notification counts are within the agreed baseline.
- Operations, IT, and security owners have signed the cutover record.

## NO-GO criteria

- Any source file changed without a new review.
- A macro, external relationship, unexpected sheet, bad header, invalid date, or row-limit failure is present.
- Reconciliation is below 100 percent or an unexplained report difference remains.
- Authentication, authorization, audit logging, backup, or restore is not working.
- The database is under pressure or the apply transaction fails.
- The rollback owner is unavailable.

## Rollback

Keep the application closed to writes. Run the migration reversal assessment first. A material production import changes related provider, call, verification, and reference tables, so restore the cutover backup for an exact rollback. Direct reversal is limited to an empty/no-material run. After restore, run database migrations only to the recorded release, verify row counts and authentication relationships, and repeat the smoke test. Record what was restored, who approved it, and when normal access resumed.
