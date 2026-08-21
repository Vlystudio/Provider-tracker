# Operations

## Required production settings

Set these as runtime secrets or configuration in the hosting platform:

- `APP_ENV=production`
- `APP_DATA_MODE=database`
- `DATABASE_URL`
- `DATABASE_POOL_SIZE`
- database idle, connection, and statement timeouts from `.env.example`
- `VERIFICATION_ACCEPTING_FRESH_DAYS` and `VERIFICATION_ACCEPTING_STALE_DAYS`
- equivalent scheduling, specialty, diagnosis, and contact freshness settings from `.env.example`
- `BETTER_AUTH_URL` using the public HTTPS origin
- `BETTER_AUTH_SECRET` with at least 32 random characters
- `AUTH_TRUSTED_ORIGINS` as a comma-separated list of approved HTTPS origins, including `BETTER_AUTH_URL`
- `AUDIT_LOG_IP_SALT` as a separate random value with at least 32 characters
- `AUTH_CLIENT_IP_HEADER` only when a trusted reverse proxy overwrites that header
- `TZ`
- `APP_MAINTENANCE_MODE=off`
- `LOG_LEVEL=info` (production rejects debug)
- `REQUEST_ID_SOURCE=generate` unless a trusted proxy replaces the header
- release/build metadata supplied by the release job
- optional `OPERATIONS_TOKEN` when the protected metrics endpoint is scraped

Generate the authentication secret and audit salt independently. Store them in the deployment secret manager. Do not put them in an image, source file, build argument, ticket, or log.

## Release order

1. Back up the database and confirm the restore procedure.
2. Run `npm ci` in the release job.
3. Run `npm run db:migrate` with the migration identity.
4. Confirm PostGIS is enabled and the geography indexes exist.
5. Run the automated checks and `npm run build`.
6. Start the new application process with the production environment.
7. Check `/sign-in`, response security headers, database connectivity after sign-in, and audit-event writes.

The image build does not need runtime secrets. The production process exits when required settings are missing or unsafe.

## Initial administrator

Run this once from a trusted shell that has production database and authentication settings:

```bash
npm run admin:bootstrap -- --email admin@example.org --name "Administrator"
```

The password prompt does not echo. For controlled automation, `PROVIDER_TRACKER_ADMIN_PASSWORD` may be supplied through a short-lived process environment and must be removed immediately afterward. The command takes a PostgreSQL advisory lock and refuses to run if an active administrator exists.

## Staff accounts

There is no public registration. An administrator creates staff through `POST /api/admin/users`. The server validates the email, name, password, and role, and records an audit event. Role and activation changes use `PATCH /api/admin/users/{id}` and revoke the target user's sessions.

Account deletion is not exposed through the application. Deactivate former staff so operational and audit references remain intact. Any retention-driven deletion must be approved and handled as a separate database change.

## Account recovery

Recovery is administrator-mediated. After confirming the staff member through the organization's normal support process, an administrator sends a new compliant password to `POST /api/admin/users/{id}/password`. The old sessions are deleted immediately. Deliver the temporary password through an approved secure channel and have the user sign in promptly.

The app does not issue public password-reset tokens or send recovery email.

## Session invalidation

- Normal logout removes the current session.
- Password reset, role change, activation, and deactivation remove all sessions for the affected user.
- For an urgent lockout, deactivate the account through the administrator endpoint.
- If the app is unavailable, a database administrator may perform the equivalent change in one transaction and record the incident separately:

  ```sql
  BEGIN;
  UPDATE users SET is_active = false, updated_at = now() WHERE email = $1;
  DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1);
  COMMIT;
  ```

Use a parameterized database tool for `$1`; do not paste an address into the SQL string.

## Reverse proxy

Terminate TLS at the app host or a managed proxy. Redirect HTTP to HTTPS before traffic reaches the app. Preserve the original `Host` and protocol. If client-address logging is required, configure one supported header and make the proxy remove any incoming copy before adding its own. Leave `AUTH_CLIENT_IP_HEADER` unset when that guarantee is not available.

Do not add permissive credentialed CORS. The browser app and APIs are intended to use the same origin.

## Database and backups

Use TLS for remote database connections, encryption at rest, a least-privilege runtime identity, a separate migration identity where possible, automated backups, and scheduled restore tests. Restrict direct database network access to the application and approved administrative hosts.

Review audit retention, log monitoring, BAA coverage, and incident response with the organization's security owner before live data is loaded.

## Provider-work automation

Run provider automation from external scheduled infrastructure, not inside the web process:

```bash
npm run jobs:daily
npm run jobs:weekly
```

The commands use database locks, persistent execution keys, bounded retry, and non-zero failure exits. Operators can run one dry check with `npm run jobs:run -- --job reverification_scan --dry-run`. Review the Automation page and structured logs before rerunning a failed job. Do not delete execution rows to bypass idempotency.

Use `AUTOMATION.md` for rules and recovery. Use `NOTIFICATIONS.md` for recipients and deduplication. An external mail service is not required; delivery is in-app only.

Use `BACKUP_RESTORE.md` for executable backup/restore steps and acceptance criteria. Use `DEPLOYMENT.md` for least-privilege roles, migration preflight, release order, and rollback. Run housekeeping from external cron/job infrastructure; its default is a read-only dry run and it never selects audit, provider history, merge, or import history for deletion.

## Phase 4 staging checks

1. Restore a recent non-production backup into a staging database.
2. Confirm the `postgis` extension is available.
3. Apply migration `0006_strange_wendell_vaughn.sql` and review its call-history backfill counts.
4. Run `npm run db:seed:phase4` only on an approved fixture database if UI examples are needed.
5. Run `npm run test:performance` against a disposable database whose name ends in `_test`.
6. Exercise one verification, failed contact, radius search, duplicate merge, and report drill-down.
7. Compare active-facility, call, verification, and relationship counts before approving production migration.
