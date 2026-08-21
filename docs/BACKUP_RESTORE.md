# Backup and restore

## Backup policy

Use encrypted IT-managed storage outside the application host and repository. Restrict write access to the backup job and restore access to database operators. Keep at least one copy in a separate failure domain. A reasonable starting policy is a nightly logical backup, 35 daily copies, 12 month-end copies, and managed point-in-time recovery when the business cannot accept a one-day recovery point.

`npm run db:backup` runs `pg_dump` in custom format, fails on any tool error, avoids putting the password on the command line, and writes a SHA-256 file and metadata next to the dump. Set `PG_BIN` only when PostgreSQL tools are not on `PATH`.

```bash
DATABASE_URL='<secret>' \
BACKUP_ENVIRONMENT=production \
BACKUP_DESTINATION=/approved/encrypted/provider-tracker \
npm run db:backup
```

The destination must be absolute and outside the repository. Check file permissions, transfer completion, checksum, age, and `pg_restore --list <file>`. A readable dump and checksum are not proof of recoverability; a restore test is required.

For production, the approved managed database backup remains authoritative. Verify its schedule, location, encryption, access control, retention, failure alert, and separate failure domain. The application command is a portable supplement and acceptance aid; it does not replace a managed backup policy.

## Restore procedure

1. Declare the recovery event and decide the accepted recovery point.
2. Stop writes or put the application in maintenance mode when required.
3. Provision a clean isolated PostgreSQL 16 database.
4. Have the DBA run `CREATE EXTENSION IF NOT EXISTS postgis;` when the service does not restore extensions automatically.
5. Verify the SHA-256 artifact and inspect it with `pg_restore --list`.
6. Restore with `pg_restore --exit-on-error --no-owner --no-acl --dbname <isolated_db> <backup.dump>`.
7. Run migration preflight, schema checks, `npm run test:postgis`, and `npm run db:audit-integrity`.
8. Compare source/control totals for users, roles, sessions when retained, facilities, specialties, diagnoses, verification history, contact attempts, calls, reports/source batches, duplicate decisions, merge history, and audit events.
9. Start the application against the isolated database and run production and authenticated staging smoke suites.
10. Confirm provider search ordering/radius boundaries, reports, authentication, and a safe audit-producing fixture mutation.
11. Obtain incident-owner approval before switching application traffic.

The automated local test creates a custom-format backup, restores it into a clean database ending in `_restore_test`, compares every critical table present in the source, checks authentication relationships, runs a PostGIS function when the source contains PostGIS, and removes the temporary database:

```bash
DATABASE_URL=postgresql://.../provider_tracker_test \
RESTORE_TARGET_DATABASE=provider_tracker_restore_test \
npm run test:restore
```

It refuses a non-test source or unsafe target name. Run the full spatial restore gate in staging because a source without PostGIS cannot prove spatial recovery.

## RPO, RTO, and capacity

Nightly logical backups alone imply a worst-case recovery point approaching 24 hours. If that is unacceptable, IT should use managed WAL archiving/point-in-time recovery and measure it. No RPO has been approved by the business.

A reasonable initial recovery-time planning target is four hours, covering provisioning, restore, validation, application startup, smoke testing, and traffic changes. This is not a commitment until IT times a staging drill at production scale.

During the Phase 9 drill, record the source backup time, incident declaration time, restore start/end, validation end, usable-service time, data cutoff, rows/events after the cutoff, database size, artifact size, and operator. Calculate the demonstrated recovery point and recovery time from those timestamps. Replace planning targets only after the business and IT owners approve the measured result.

Planning assumptions: 50 staff, 200 calls per workday, 100 verification events per workday, 200 contact attempts per workday, and 1,000 audit events per calendar day. Including indexes and 30% working headroom, estimate roughly 2.5 GB after year 1, 5.5 GB after year 3, and 8.5 GB after year 5. Actual notes, JSON, index bloat, and import volume can change this substantially. At year 5, 35 compressed full backups may require roughly 120–300 GB before month-end/off-site copies. IT must replace these estimates with staging compression and growth measurements.

Highest-growth tables are `audit_events`, `calls`, `facility_contact_attempts`, and `facility_verification_events`. Keep operational history unless an approved retention policy says otherwise. Expired auth artifacts are handled separately by housekeeping.

## Disaster-recovery drill

Scenario: the primary database is lost. The incident lead stops writes, identifies the latest verified recovery point, provisions a replacement, restores it, runs the complete validation above, switches the application secret to the replacement, waits for readiness, runs smoke tests, restores traffic, and records actual RPO/RTO. The database owner handles provisioning/PITR; the application owner runs validation; security approves any live-data handling; the incident lead owns traffic and communications.

The Phase 9 drill must use an isolated recovery database and include PostGIS extension/version, SRID constraints, spatial indexes, distance ordering, authentication relationships, facilities, coordinates, provider relationships, verification/contact history, migration provenance, automation tables, and audit events. Do not overwrite active staging for the drill.
