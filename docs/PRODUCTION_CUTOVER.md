# Production cutover

Use this checklist only after `PHASE9_ACCEPTANCE.md` records an approved pilot status. Name the cutover lead, database operator, application operator, migration reviewer, identity owner, network owner, operations owner, security contact, and rollback decision owner.

## Before the window

- [ ] Phase 9 GO decision recorded.
- [ ] Pilot cohort and least-privilege roles approved.
- [ ] VPN, private DNS, direct-origin blocking, TLS, and proxy behavior passed.
- [ ] Identity strategy and required MFA passed.
- [ ] PostgreSQL network isolation, TLS, runtime grants, PostGIS, and geographic benchmark passed.
- [ ] Managed secrets loaded and rotation rehearsal passed.
- [ ] Final image digest, source commit, SBOM, dependency audit, and image scan retained.
- [ ] Central logs, request correlation, monitoring, alerts, and scheduler passed.
- [ ] Managed backup succeeded and full isolated PostGIS restore passed.
- [ ] Final workbook rehearsal, reconciliation, reporting parity, and UAT passed.
- [ ] Pre-cutover backup name, checksum, recovery point, and restore owner recorded.
- [ ] Legacy workbook write freeze and user notice confirmed.
- [ ] Prior compatible image, forward-fix plan, restore plan, and rollback deadline confirmed.

## During the window

1. Announce the start and stop legacy writes and scheduled jobs.
2. Record current release, database migration, row counts, job state, and health.
3. Complete and verify the named pre-cutover backup.
4. Run production preflight against the exact target with the migration identity.
5. Apply approved migrations. Do not grant migration rights to the runtime identity.
6. Deploy the exact image digest certified in staging.
7. Wait for readiness before routing pilot traffic.
8. Validate TLS, identity, MFA, role access, session revocation, provider search, 50-mile search, reporting, audit, metrics, and central log correlation.
9. Run the final frozen-workbook preview. Compare hashes and counts with the approved rehearsal.
10. Obtain the named migration approval, apply once, and reconcile every source row and report total.
11. Start automation in dry-run mode. Check counts and notification volume before enabling the schedule.
12. Record GO or begin rollback.

## After GO

- [ ] Monitor sign-in, authorization denials, 5xx, latency, pool use, locks, and resource use.
- [ ] Confirm scheduled jobs ran once and wrote execution history.
- [ ] Confirm central alerts reach the assigned destination.
- [ ] Confirm the next managed backup and its failure alert.
- [ ] Review migration audit events and data-quality/report baselines.
- [ ] Collect pilot feedback by severity and category.
- [ ] Keep the legacy workbook read-only and archived.

## Rollback triggers

Rollback or stop the pilot for authentication/MFA unavailability, public or origin exposure, privilege bypass, database exposure, data corruption, unexplained reconciliation mismatch, incorrect reports, unusable provider search, failed audit logging, failed backup/recovery, or a serious performance regression.

## Rollback method

1. Stop pilot traffic and scheduled writes. Preserve logs, audit, identity, ingress, database, and deployment evidence.
2. If the schema remains compatible, route to the prior approved image and repeat readiness and smoke checks.
3. Do not reverse schema destructively to make old code start. Use an approved forward fix for compatible data/schema problems.
4. Use a database restore only when the incident owner accepts loss after the chosen recovery point. Restore into an isolated target, validate it, then switch traffic.
5. Reconcile all writes in the affected window and tell users exactly what may need re-entry.
6. Record the decision, operator, image, database, recovery point, checks, and time normal service resumed.

Application rollback, migration forward-fix, and database restore are separate decisions.
