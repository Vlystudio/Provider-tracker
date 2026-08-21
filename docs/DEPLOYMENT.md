# Deployment

## Production path and ownership

```text
Browser → IT-managed HTTPS proxy/load balancer → Node.js application → IT-managed PostgreSQL/PostGIS
                                                    │
                                                    └→ stdout logs and protected metrics → IT monitoring
```

This repository contains the application image, schema migrations, probes, smoke tests, and database operations commands. IT owns DNS, certificates, proxy rules, compute, PostgreSQL/PostGIS, secret storage, log collection, monitoring, backup storage, and traffic changes.

The application is a persistent Node.js 22 process using Next.js 16 App Router. It uses npm, a bounded `pg` pool, Drizzle migrations, Better Auth database sessions, and no in-process scheduled jobs. The container runs as an unprivileged user and handles `SIGTERM` by marking itself unready and closing the pool.

## Environment separation

| Setting | Development | Test | Staging | Production |
| --- | --- | --- | --- | --- |
| `APP_ENV` | `development` | `test` | `production` | `production` |
| `APP_DATA_MODE` | `demo` or `database` | `database` | `database` | `database` |
| Public origin | HTTP allowed | isolated | HTTPS | HTTPS |
| `LOG_LEVEL` | `debug` allowed | `info` | `info` | `info` or stricter |
| Credentials | local only | disposable | dedicated fixtures | organization accounts |

Production startup rejects demo mode, debug logging, non-HTTPS authentication origins, missing secrets, weak optional metrics tokens, and placeholder secrets. Do not copy test accounts or `.env` files between environments.

## Build identity

Set immutable build arguments from the release job:

```bash
docker build \
  --build-arg APP_VERSION=0.1.0 \
  --build-arg APP_RELEASE=0.1.0-abc1234 \
  --build-arg BUILD_COMMIT=abc1234 \
  --build-arg BUILD_TIMESTAMP=2026-08-21T16:00:00Z \
  -t provider-tracker:0.1.0-abc1234 .
```

Use a clean, reviewed commit and retain the image digest. The release appears in JSON logs, `/api/health`, `/api/ready`, and `X-App-Release`.

## Database roles

Use three login roles. The database owner or managed-service administrator creates PostGIS; the application role must not own the schema.

```sql
CREATE ROLE provider_migration LOGIN;
CREATE ROLE provider_runtime LOGIN;
CREATE ROLE provider_backup LOGIN;

GRANT CONNECT ON DATABASE provider_tracker TO provider_migration, provider_runtime, provider_backup;
GRANT USAGE, CREATE ON SCHEMA public TO provider_migration;
GRANT USAGE ON SCHEMA public TO provider_runtime, provider_backup;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO provider_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO provider_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO provider_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO provider_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE provider_migration IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO provider_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE provider_migration IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO provider_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE provider_migration IN SCHEMA public
  GRANT SELECT ON TABLES TO provider_backup;
```

The DBA must adapt role and database names to local policy. Verify runtime permissions by running the staging smoke suite as the runtime role. Do not grant `SUPERUSER`, `CREATEDB`, `CREATEROLE`, schema ownership, or extension-management privileges to the runtime role.

## Migration workflow

Classify each migration during review:

- additive: new nullable columns, tables, or concurrent indexes; usually compatible with rolling deployment;
- potentially locking: type changes, constraints, non-concurrent indexes, and large backfills; schedule and test;
- destructive: drops, narrowing changes, or irreversible rewrites; require an approved data plan;
- data transformation: backfills or normalization; record before/after counts and restart behavior.

Release order:

1. Identify the target and complete a verified backup.
2. Run `TARGET_ENVIRONMENT=staging CONFIRM_DATABASE=<name> npm run db:preflight`.
3. Review pending SQL, lock risk, application compatibility, and rollback decision point.
4. Run `npm run db:migrate` with the migration role.
5. Run `npm run test:postgis` and schema validation.
6. Deploy the immutable application image with the runtime role.
7. Wait for `/api/ready` and run `npm run test:smoke`.
8. Run the authenticated staging suite before production approval.

Production preflight also requires `BACKUP_FILE` to point to the approved artifact. `CONFIRM_DATABASE` must exactly match the database name for staging or production.

## Deployment checklist

Before deployment:

- [ ] clean reviewed commit and immutable image digest recorded
- [ ] CI, dependency audit, secret scan, security matrix, and staging acceptance pass
- [ ] target database and migration role confirmed
- [ ] current backup restored successfully in an isolated database
- [ ] migration classification, expected duration, and rollback decision approved
- [ ] production secrets, HTTPS origin, monitoring token, and release metadata loaded

Deploy:

- [ ] run preflight and approved migrations
- [ ] validate PostGIS and critical schema
- [ ] start the new application release
- [ ] wait for readiness before routing traffic
- [ ] run the production smoke test

After deployment:

- [ ] verify sign-in, provider radius search, reports, and audit writes
- [ ] inspect 5xx, latency, pool waiting, and authentication-failure metrics
- [ ] record release, migration, operator, backup, and smoke result

## Rollback

Rollback the application image when the prior image remains schema-compatible. Stop or drain traffic first if writes could make the old code unsafe. Do not automatically reverse a schema migration. Additive migrations normally remain in place; unsafe data transformations require a forward fix or restore to a new database. A restore is a separate incident decision because it discards writes made after the recovery point.

After an application rollback, wait for readiness, run smoke tests, verify authentication and geographic search, and record the incident. Never drop a column or table merely to make an older image start.

## Common deployment failures

| Symptom | Likely cause | Check | Safe action |
| --- | --- | --- | --- |
| Preflight permission failure | wrong role | preflight `permissions` | use approved migration role; do not elevate runtime |
| PostGIS missing | extension not enabled | `npm run test:postgis` | DBA enables PostGIS, then rerun migrations |
| Wrong database warning | target mismatch | database in preflight output | stop; correct secret/target and reconfirm |
| Process exits at startup | unsafe environment | structured startup error | correct the named setting in secret/config store |
| Readiness 503 | database/schema/maintenance | `/api/ready`, application logs | remove instance from traffic and fix failed check |
| Sign-in unavailable | origin, secret, database | auth logs and database reachability | restore the prior known configuration; do not bypass auth |
| Schema ahead of checkout | wrong release or drift | preflight migration counts | stop and reconcile release history before mutation |
