# Phase 5 acceptance

Date: 2026-08-21

Status: **COMPLETE WITH NON-BLOCKING INFRASTRUCTURE FOLLOW-UP**

Repository work is complete and locally available gates pass. Staging PostGIS, authenticated staging smoke, external monitoring delivery, HTTPS/DNS, managed backups, and infrastructure approval still belong to IT. Current boundary: **APPLICATION PRODUCTION-READY — INFRASTRUCTURE APPROVAL PENDING**.

## Runtime and observability

- `/api/health` is a dependency-free liveness endpoint.
- `/api/ready` checks traffic state, database, critical schema, PostGIS, and the geography index.
- a production-style dependency failure returned health 200 and readiness 503;
- the same failure returned a bounded request ID that appeared in the structured server log;
- the database password marker did not appear in response or logs;
- maintenance mode kept health at 200, readiness at 503, redirected pages to the maintenance message, and returned 503 for APIs;
- the metrics endpoint returned 404 without its bearer token and Prometheus text with the token;
- graceful shutdown state and pool cleanup passed an automated test;
- release `0.1.0` appeared in health and response headers.

Structured logging, fixed error categories, recursive redaction, safe metric labels, operation timing, pool metrics, and the vendor-neutral error-reporting boundary have unit coverage.

## Backup and restore

The standalone backup command created a PostgreSQL custom-format artifact, SHA-256 file, and metadata outside the repository. It exited successfully and did not put the database password on its command line.

A real isolated restore was completed with local PostgreSQL tools:

- dump size: 46,329 bytes;
- SHA-256: `7b1d24e39653510d1b27ed8af37f57fcd95e80eaab0006e980e3e10920eb603e`;
- target: a newly created database ending in `_restore_test`;
- restored counts matched for 3 users, 3 accounts, 2 sessions, 2 facilities, 2 specialty relationships, 2 diagnosis relationships, 2 verification events, 1 contact attempt, 1 merge record, and 26 audit events;
- authentication relationships passed;
- the temporary restore database was removed by the test.

The source test database does not contain PostGIS, so this proves the non-spatial restore path only. The staging restore must separately prove extension, point columns, SRID constraints, spatial indexes, distance queries, application readiness, and authenticated workflows.

## Database operations

- pool size, idle timeout, connection timeout, statement timeout, pool failure behavior, and shutdown cleanup are configurable and bounded;
- migration preflight checks target identity, explicit staging/production confirmation, backup presence for production, PostGIS, permissions, local migration hashes, journal presence, and migration history count;
- the staging spatial gate checks the extension, point columns, SRID 4326 constraints, three GiST indexes, distance ordering, 10-mile boundary behavior, and null coordinates;
- housekeeping is an explicit external job, dry-run by default, bounded to 1,000 rows by default, and limited to expired sessions/tokens and inactive rate-limit buckets;
- audit, verification, contact, merge, and import history are retained;
- audit integrity passed with zero missing required actors, invalid timestamps, unknown actions, or broken live actor references. Detached historical account/target counts remain visible without editing history;
- migration, runtime, and backup database-role grants are documented separately.

Local migration preflight stopped at the expected PostGIS requirement. The local server does not provide PostGIS, so no full migration or spatial benchmark result is claimed.

## Performance and resilience

The staging benchmark creates at least 10,000 facilities, 10,000 specialty links, 10,000 diagnosis links, and 100,000 verification records. It measures median/p95, returned rows, plan root, and indexes for 10/25/50/100-mile and combined/ranked geographic queries. It was not run locally because PostGIS is unavailable.

The bounded local HTTP run used 100 requests at concurrency 10 with zero network/5xx errors:

| Path | p50 | p95 |
| --- | ---: | ---: |
| `/api/health` | 104.3 ms | 186.4 ms |
| `/api/ready` | 107.0 ms | 166.8 ms |
| `/sign-in` | 197.7 ms | 266.7 ms |
| `/api/session` | 106.0 ms | 298.9 ms |
| `/provider-search` | 65.3 ms | 104.3 ms |

These measurements used the local development instance and are not production capacity results. Staging must repeat them with database-backed authenticated traffic while monitoring connections, CPU, memory, and PostgreSQL statistics.

## Verification

Final release acceptance before this record:

- unit/integration: 84 passed across 21 files;
- security matrix: 47/47 passed;
- provider verification, contact, merge/history, authorization, account, report-permission, CSRF, session, rate-limit, and audit scenarios passed;
- ESLint: passed;
- TypeScript: passed;
- production build: passed;
- production dependency audit: 0 vulnerabilities;
- secret scan: passed across 188 files and 23 commits;
- security headers: passed in the live security matrix and smoke suite;
- local production smoke: passed for entry, sign-in, health, readiness, anonymous API rejection, request ID, release, and headers;
- dependency failure, redaction/correlation, protected metrics, and maintenance acceptance: passed;
- backup command: passed;
- isolated non-spatial restore: passed;
- audit integrity and housekeeping dry-run: passed.

Not run locally and not reported as passing:

- PostGIS migration/spatial gate;
- 10,000/50,000-facility geographic benchmark;
- prior-version-to-current migration acceptance;
- restored PostGIS application smoke;
- authenticated staging suite with URA/auditor/admin fixture accounts;
- external log, metrics, and alert delivery;
- CI workflow on a hosted runner.

## Version control

Starting HEAD: `a7a5419`

Implementation HEAD before this acceptance record: `e40cc23`

Branch: `master`

Commits:

1. `8bfb863` Add runtime health and operational telemetry
2. `9a8af6c` Harden readiness and authentication audit identity
3. `19b557d` Add database recovery and staging gates
4. `f664b5b` Add release and resilience acceptance automation
5. `cce6f09` Document deployment recovery and IT operations
6. `71fce37` Tighten release and spatial acceptance checks
7. `e40cc23` Verify maintenance and protected monitoring behavior

No Git remote is configured. Nothing was pushed.

## IT-owned follow-up

| Owner | Required action | Verification | Deployment impact |
| --- | --- | --- | --- |
| Database team | provide PostgreSQL/PostGIS, enable extension, create least-privilege roles, run migration/spatial gate | preflight, migration, `test:postgis`, 10k/50k benchmark | blocks staging database approval |
| Platform/application teams | provision HTTPS staging with dedicated fixture accounts and provider record | production and authenticated staging smoke suites | blocks application staging approval |
| Database/backup teams | store encrypted backups and perform full PostGIS restore drill | checksum, restore, spatial/app checks, measured RPO/RTO | blocks recovery approval |
| Monitoring team | collect JSON logs, scrape token-protected metrics, configure probes/alerts | staging request trace and alert delivery test | blocks operations approval |
| Network/platform team | configure DNS, TLS, proxy header replacement, health routing, and controlled rollout | HTTPS/cookie/header tests and instance drain | blocks production traffic |
| Change owner | review staging evidence and approve deployment/rollback plan | signed deployment checklist | blocks production release |
