# Phase 9 acceptance

Date: 2026-08-21

## Status

`PRODUCTION PILOT BLOCKED — INFRASTRUCTURE VALIDATION REQUIRED`

Repository-side staging safeguards, evidence gates, network probes, configuration checks, release records, and rollout procedures are ready. No production-like staging environment or authorized pilot evidence was available, so no infrastructure or business approval is claimed.

## VPN / Network

- External reachability: not tested; no authorized outside-VPN target or test position was supplied.
- Private DNS: not configured or tested.
- Origin exposure: not tested; no origin hostname/IP inventory was supplied.
- Proxy trust: application spoofing controls pass locally; the real proxy product/configuration is not available.
- Database exposure: not tested from public, ordinary VPN, and application subnets.
- Repository tools: expanded outside-VPN hostname/API/origin/database probe and a separate ordinary on-VPN TLS/proxy/database probe.

`VPN-ONLY ACCESS REQUIRES IT STAGING VALIDATION`

## Identity

- Current model: Better Auth email/password with database sessions, disabled public registration, fixed eight-hour lifetime, 30-minute idle limit, 15-minute recent-login window, account disablement, and session revocation.
- Corporate SSO: not selected or configured. No issuer, client registration, tenant, claims, or linking policy was supplied.
- MFA: not implemented or validated. This blocks privileged production access.
- Role mapping: application roles remain server-controlled; no external role claim is trusted.
- Session behavior: local fixation, expiry, idle, logout, password/role/activation change, and revocation scenarios pass in the 86-case security suite.

The required provider decision, stable issuer/subject linking, migration review, MFA claims, failure matrix, and local-login cutover are in `IDENTITY_INTEGRATION.md`.

## PostgreSQL/PostGIS

- Local database: PostgreSQL 18.0 test instance; PostGIS not installed.
- Staging versions: not supplied.
- Migration result: normal migrations and 11 migration scenarios pass locally; production-like PostGIS migration is pending.
- Spatial columns/indexes: repository migrations and checks exist; staging evidence pending.
- Geographic correctness: deterministic gate exists; could not run without PostGIS.
- Geographic benchmark: 10,000/50,000/100,000-facility staging measurements pending.
- Network isolation and DB TLS: pending actual infrastructure.
- Least privilege: 12/12 simulated runtime-role cases passed locally; actual staging grants pending.

Local `db:preflight`, `test:postgis`, and `test:performance` stopped at the expected missing-PostGIS gate. That is an unavailable local dependency, not a staging pass or a discovered staging defect.

## Container

- Dockerfile: pinned Node 22 Alpine build/runtime, standalone output, UID 10001, non-root runtime.
- Runtime template: read-only root, dedicated temp/cache mounts, all capabilities dropped, no-new-privileges, PID limit, 1 GB memory limit, one CPU, and 30-second stop window.
- Image build: not run; Docker CLI is installed but the local Docker engine is stopped.
- Image scan: not run locally. CI is configured to fail on Critical/High OS/library findings and retain JSON scan/image records.
- Findings: no container finding can be claimed without the final image scan.

## Operations

- Logs: structured/redacted application output passes local tests; no central collector was supplied.
- Correlation: local response/log/database correlation passes; central end-to-end lookup pending.
- Monitoring/alerts: protected metrics and failure signals pass locally; no monitoring destination or alert route was supplied.
- Scheduler: 16/16 job/idempotency scenarios pass; no production scheduler exists yet.
- Backup/restore: managed backup is not configured. Local restore acceptance could not start because `pg_dump`/`pg_restore` are unavailable.
- RPO/RTO: planning values remain unapproved; no production-scale staging drill was timed.

## Migration

- Source/rehearsal data: synthetic fixtures only; no authorized realistic workbook was supplied.
- Reconciliation: 11/11 migration scenarios passed, including row accountability, source hash change, transaction rollback, newer-value protection, and concurrent lock.
- Conflicts/reporting parity/automation initialization: procedures and automated fixtures pass; real-source evidence pending.
- Planning performance: 1,000 rows in 9 ms, 10,000 in 25 ms, and 50,000 in 110 ms on this workstation. These are planning measurements, not staging import timings.

## Security

- Hostile-request suite: 86/86 passed locally.
- Static runtime/API audit: 135 runtime source files and 36 API route files passed.
- Database privilege matrix: 12/12 passed locally.
- Staging network/manual tests: not run.
- Critical application findings: 0 open.
- High application findings: 0 open.
- Infrastructure findings: VPN/origin/database isolation, corporate MFA, TLS/secrets, image scan, centralized detection, egress, and recovery remain blocking until tested.

## Performance

No staging/VPN p50 or p95 is available for sign-in, dashboard, normal search, 50-mile search, reports, or work inbox.

Local automation performance passed six operations on a 10,000-record planning set: stale scan 24.4 ms, quality scan 3.2 ms, duplicate detection 28.9 ms, coverage evaluation 0.8 ms, digest generation 1.3 ms, and notification generation 2.7 ms. These do not replace network, database, pool, CPU, memory, load, or concurrency measurements from staging.

## UAT / Pilot

- Roles tested locally by automated authorization scenarios: URA, report viewer, auditor, and admin.
- Real-user scenarios: prepared in `UAT.md` and `PILOT_ROLLOUT.md`; not executed.
- Blocking pilot defects: none recorded because the pilot has not started.
- Pilot cohort: not supplied.
- Business approval: not supplied and not inferred.

## Verification

| Gate | Result |
| --- | --- |
| ESLint | PASS |
| TypeScript | PASS |
| Unit/component/service tests | PASS: 31 files, 135 tests |
| Production build | PASS: Next.js 16.3.2 |
| Production dependency audit | PASS: 0 vulnerabilities |
| Supply-chain audit | PASS: 760 lock records, 5 reviewed lifecycle scripts |
| Static security audit | PASS: 135 runtime source files, 36 API route files |
| Secret repository/history scan | PASS: 301 files, 35 commits before this acceptance record |
| Hostile-request security | PASS: 86/86 |
| Database privilege | PASS: 12/12 locally; staging grants pending |
| Automation | PASS: 16/16 |
| Automation performance | PASS: 6 operations on 10,000 records |
| Migration | PASS: 11/11 |
| Migration planning performance | PASS: 1,000/10,000/50,000 |
| Dependency failure/maintenance | PASS |
| Audit integrity | PASS |
| Development and production Compose rendering | PASS with non-secret check values |
| PostGIS preflight/correctness/performance | PENDING: PostGIS unavailable locally; staging required |
| Full spatial restore | PENDING: local PostgreSQL backup tools and staging PostGIS unavailable |
| Container build/scan | PENDING: local Docker engine unavailable; CI gate configured |
| VPN/DNS/origin/TLS/proxy/database segmentation | PENDING: no authorized staging infrastructure |
| Corporate identity/MFA | PENDING: no approved identity configuration |
| Central logging/alerts/scheduler/managed backup | PENDING: no infrastructure integrations |
| Staging load/concurrency/security scan | PENDING: no authorized target |
| Business UAT/pilot | PENDING: no cohort or sign-off |

## Repository

- Starting HEAD: `0ac8234e5aabd75e0eea631102387e400c797e75`
- Phase 9 implementation commits before this record: `c21213d` and `2f4708a`
- Final HEAD: this acceptance record commit; use `git rev-parse HEAD` in the delivery record.
- Branch: `master`
- Working tree: must be clean after the acceptance commit.
- Remote: none configured.
- Push status: not pushed. The Phase 9 brief did not authorize a push.

## Remaining work

### Deployment blockers

1. Provide a production-like private staging environment and complete the full readiness record.
2. Prove outside-VPN blocking, on-VPN reachability, private DNS, direct-origin blocking, proxy sanitation, TLS, and database segmentation.
3. Approve and validate the production identity strategy and required MFA.
4. Configure managed secrets and complete failure/rotation tests.
5. Run PostGIS migration, spatial correctness, indexes, least privilege, DB TLS, and geographic benchmark on staging.
6. Build, scan, record, and inspect the final image on the approved runtime.
7. Connect and test central logs, metrics, alerts, egress policy, scheduler, managed backup, and isolated full spatial restore.
8. Rehearse the realistic workbook migration, reconcile reports/data, complete UAT, and name the pilot cohort and approvers.
9. Run staging security, load, concurrency, failure, rolling-restart, and rollback tests.

### Pilot non-blockers

None have been classified. Pilot follow-up can be judged only after all blockers pass and the pilot begins.

### Future enhancements

- preferred 50,000-facility and stretch 100,000-facility geographic baselines;
- alert tuning after real traffic produces a stable baseline;
- approved enhancements raised through pilot feedback after stabilization.

## Final decision

The application repository remains ready for IT staging work. The production pilot is not approved until the actual surrounding infrastructure and business acceptance gates pass.
