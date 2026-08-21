# IT handoff

Legacy data cutover is covered by [MIGRATION.md](MIGRATION.md), [CUTOVER.md](CUTOVER.md), [RECONCILIATION.md](RECONCILIATION.md), and [UAT.md](UAT.md). Apply all database migrations through `0011_fair_bastion.sql` before using the migration screen.

For a release that includes legacy data, add these commands to the normal acceptance run:

```text
npm run test:migration
npm run test:migration-performance
```

Use a database name ending in `_test` for the migration acceptance command. Production workbook files should stay in IT-controlled storage; the application keeps hashes and review records, not uploaded workbook contents.

| Item | Requirement | Validation | Owner |
| --- | --- | --- | --- |
| PostgreSQL | PostgreSQL 16, encrypted storage/transport, private network, capacity monitoring | connection and version in `npm run db:preflight` | database team |
| PostGIS | compatible PostGIS installed and extension enabled by privileged owner | `npm run test:postgis` | database team |
| Database roles | separate migration, runtime, and backup identities; runtime is not owner/superuser | permission output plus staging smoke | database/security teams |
| Credentials | unique per environment in approved secret manager; rotation procedure | production startup and sign-in smoke | security/platform team |
| Corporate identity | approved local-MFA or enterprise identity strategy; stable user linking; privileged MFA | identity matrix in `IDENTITY_INTEGRATION.md` | identity/security teams |
| HTTPS and DNS | trusted certificate, HTTP redirect, correct host/protocol forwarding | browser/curl and secure cookie test | network/platform team |
| VPN and origin | no public route; private DNS; direct origin blocked; database segmented | outside/on-VPN commands in `NETWORK_SECURITY_VALIDATION.md` | network/security teams |
| Compute | Node.js 22 image/process, `SIGTERM`, health/readiness routing, at least two instances if availability requires | controlled restart and drain test | platform team |
| Backup destination | encrypted, access-controlled, separate failure domain, retention job | backup job, checksum, isolated restore | database/backup team |
| Monitoring | collect JSON stdout, scrape protected metrics, configure probes and alerts | staging alert and request-ID trace | monitoring team |
| Scheduled jobs | invoke the daily and weekly commands after the configured local hour; retain command exit status and logs | dry run, duplicate invocation, missed-run recovery | platform team |
| Staging | production-like PostgreSQL/PostGIS, HTTPS, dedicated fixture accounts/data | `STAGING_ACCEPTANCE.md` | platform/application teams |
| Production | approved environment, incident contacts, change window, traffic/rollback control | deployment checklist and smoke | change owner |

## Required runtime configuration

Supply every active setting in `.env.example`. Production requires database mode, HTTPS Better Auth URL and trusted origin, independent authentication/audit secrets, non-debug logging, explicit maintenance mode, pool/timeouts, freshness policy, time zone, and immutable release values. `OPERATIONS_TOKEN` is optional; without it metrics are disabled. `AUTH_CLIENT_IP_HEADER` and `REQUEST_ID_SOURCE=trusted-proxy` are allowed only when the proxy overwrites inbound values.

Use `config/production.env.template` as the key list. It contains no deployable credentials. Before approval, export secret-safe staging and production environment files from the platform and run:

```text
npm run audit:configuration-drift -- --staging <staging-file> --production <production-file>
```

The command validates each profile and reports differences without printing or comparing secret values.

Recommended starting pool size is 5–10 connections per instance. Confirm `instances × pool size + migration/admin headroom` stays below the database connection limit. Adjust using pool waiting and query latency, not a hard-coded production assumption. Defaults are a 30-second idle timeout, 10-second connection timeout, 15-second statement timeout, and 20-second graceful shutdown window.

## PostGIS checklist

- [ ] supported PostgreSQL/PostGIS versions selected
- [ ] extension installed and enabled by the database owner
- [ ] all migrations applied with the migration role
- [ ] point columns report SRID 4326
- [ ] geometry and cast-to-geography GiST indexes exist
- [ ] 10-mile boundary and null-coordinate checks pass
- [ ] 10,000-facility benchmark passes and plans are retained
- [ ] backup contains extension/spatial schema
- [ ] isolated restore preserves spatial columns, indexes, and queries

## Scheduled execution

The app does not run background timers. Configure one approved scheduler such as cron, a Kubernetes CronJob, Windows Task Scheduler, or the hosting platform's job runner. It only needs the same production environment and network access as the web process.

```bash
npm run jobs:daily
npm run jobs:weekly
```

Call the daily wrapper after the hour shown on the Automation page. Call the weekly wrapper after that hour on the configured weekday. It is safe to invoke either wrapper twice: stable execution keys, unique records, and PostgreSQL advisory locks prevent duplicate work.

Capture stdout/stderr and alert on a non-zero exit. Do not place database credentials in the scheduler command. Supply them from the approved secret store. See `AUTOMATION.md` for missed-run limits, manual recovery, and dry-run commands.

## Approval boundary

The application team can mark repository work ready and provide passing local checks. IT must separately approve the Phase 9 network, identity/MFA, TLS, secrets, PostGIS, database isolation, container, monitoring, backup/restore, scheduler, migration, and pilot gates in [STAGING_CERTIFICATION.md](STAGING_CERTIFICATION.md). Until those checks run, status is **PRODUCTION PILOT BLOCKED — INFRASTRUCTURE VALIDATION REQUIRED**.
