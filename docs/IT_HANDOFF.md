# IT handoff

| Item | Requirement | Validation | Owner |
| --- | --- | --- | --- |
| PostgreSQL | PostgreSQL 16, encrypted storage/transport, private network, capacity monitoring | connection and version in `npm run db:preflight` | database team |
| PostGIS | compatible PostGIS installed and extension enabled by privileged owner | `npm run test:postgis` | database team |
| Database roles | separate migration, runtime, and backup identities; runtime is not owner/superuser | permission output plus staging smoke | database/security teams |
| Credentials | unique per environment in approved secret manager; rotation procedure | production startup and sign-in smoke | security/platform team |
| HTTPS and DNS | trusted certificate, HTTP redirect, correct host/protocol forwarding | browser/curl and secure cookie test | network/platform team |
| Compute | Node.js 22 image/process, `SIGTERM`, health/readiness routing, at least two instances if availability requires | controlled restart and drain test | platform team |
| Backup destination | encrypted, access-controlled, separate failure domain, retention job | backup job, checksum, isolated restore | database/backup team |
| Monitoring | collect JSON stdout, scrape protected metrics, configure probes and alerts | staging alert and request-ID trace | monitoring team |
| Staging | production-like PostgreSQL/PostGIS, HTTPS, dedicated fixture accounts/data | `STAGING_ACCEPTANCE.md` | platform/application teams |
| Production | approved environment, incident contacts, change window, traffic/rollback control | deployment checklist and smoke | change owner |

## Required runtime configuration

Supply every active setting in `.env.example`. Production requires database mode, HTTPS Better Auth URL and trusted origin, independent authentication/audit secrets, non-debug logging, explicit maintenance mode, pool/timeouts, freshness policy, time zone, and immutable release values. `OPERATIONS_TOKEN` is optional; without it metrics are disabled. `AUTH_CLIENT_IP_HEADER` and `REQUEST_ID_SOURCE=trusted-proxy` are allowed only when the proxy overwrites inbound values.

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

## Approval boundary

The application team can mark repository work ready and provide passing local checks. IT must separately approve staging PostGIS, HTTPS, database roles, monitoring delivery, backups/restores, capacity, and production change controls. Until those checks run, status is **APPLICATION PRODUCTION-READY — INFRASTRUCTURE APPROVAL PENDING**.
