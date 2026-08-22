# Retention and deletion

Last reviewed: 2026-08-22

No company retention period is defined in this repository. Business, privacy, legal, security, and records owners must approve the schedule.

## Current behavior

Business records, verification history, contact history, audit events, access reviews, migrations, notifications, work history, reports, job executions, and governance records are retained. No production deletion is active by default.

Three low-level cleanup categories have an implemented, policy-gated path:

| Category | Table/date | Purpose | Default |
| --- | --- | --- | --- |
| `expired_sessions` | `sessions.expires_at` | Remove unusable session rows after the approved period | Retain; no period configured |
| `expired_verification_tokens` | `verification_tokens.expires_at` | Remove expired verification/reset values | Retain; no period configured |
| `inactive_rate_limit_buckets` | `auth_rate_limits.last_request` | Remove old brute-force buckets | Retain; no period configured |

Other categories are documented but deliberately have no delete command: operational current data, verification/contact history, audit history, notifications/digests, job history, migration provenance/raw rows, user accounts, report snapshots, access reviews, security logs, and backups.

## Policy configuration

An administrator with a recent login can store a retention period and controlled-policy reference. Enabling deletion additionally requires:

- a period between 1 and 36,500 days;
- an approved policy reference;
- the approving user and time;
- typing `ENABLE RETENTION`;
- the database constraint that rejects an incomplete approval.

Disabling a policy clears the deletion approval. Policy changes write `retention.policy-update` with old/new days and enabled state. The full policy document stays in the organization’s controlled document system, not this database.

## Dry run

The governance page and `POST /api/governance/retention/dry-run` return category, cutoff, eligible count, held count, dependency list, configured state, and deletion-enabled state. They never delete.

The command below is also a dry run unless `--apply` is present:

```powershell
npm run db:housekeeping
```

If a period is not configured, the result is `not_configured` and zero rows are touched.

## Destructive command safeguards

`npm run db:housekeeping -- --apply` is the only application cleanup command for these categories. It requires all of the following:

- exact database confirmation for any database not ending in `_test`;
- explicit `TARGET_ENVIRONMENT`;
- `HOUSEKEEPING_APPROVAL=approved`;
- `HOUSEKEEPING_ACTOR_ID` for an active administrator or service account;
- a stored period;
- stored approval evidence;
- deletion enabled for that category;
- a bounded `HOUSEKEEPING_BATCH_SIZE` from 1 to 10,000;
- exclusion of active holds;
- one transaction and audit event per category/batch.

No scheduled command in the repository passes `--apply`.

## Holds

A hold can protect a whole category or one record. The hold stores category, optional table/record ID, reason code, placer/time, and release actor/time. It does not store a case narrative.

Active holds are excluded from dry-run eligible counts and deletion batches. `incident_preservation` is the standard synthetic/test reason; the organization must approve real reason codes and release authority.

Application holds cover only the three implemented cleanup tables today. Business/audit data is already retained because no delete command exists. Infrastructure log and backup holds must be placed in their own systems.

## Referential integrity

The implemented cleanup categories are temporary/security state:

- expired sessions reference users and can be removed without removing the user;
- expired verification tokens have no business-history child;
- inactive rate-limit buckets have no child records.

The cleanup command does not delete verification events, contact attempts, audit events, merge records, migration provenance, access decisions, or report history. Expanding deletion to those tables requires a new dependency review, migration, dry-run test, backup/restore test, and approved policy.

## Soft delete and archive review

Facilities use `active`, `archived_at`, and `merged_into_facility_id`. Provider search and report queries require active, non-merged facilities. Merge/duplicate history remains available to administrators. Assignment/work status is not a delete marker. Notifications use read state, not soft deletion.

Authorization hard delete is admin-only and audited. This predates the retention engine and should be used only under the approved operational rule. It does not claim to remove backup copies.

## Permanent deletion review

Technically appropriate candidates are expired sessions, expired verification tokens, and inactive rate-limit buckets. Notification, job, temporary migration, and export metadata may become candidates after an approved schedule and dependency review.

Operational truth, verification/contact history, audit events, migration provenance, merge history, and access decisions must not be permanently deleted by a default housekeeping value.

## Backups and restored data

Live deletion is not immediate total erasure. Deleted records may remain in encrypted backups until those backups expire. IT must document backup retention separately.

After a restore:

1. Keep the restored system isolated.
2. Reapply account disables, session revocations, active holds, and post-backup configuration changes.
3. Confirm access-review, retention-policy, and hold tables were restored.
4. Run the retention dry run again.
5. Do not expose restored data until security and data owners approve.

Incident evidence under hold must not be removed by normal live-database, log, or backup housekeeping.
