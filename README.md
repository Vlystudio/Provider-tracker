# Provider Tracker

Provider Tracker is an internal web app for facility discovery, availability verification, follow-up, duplicate review, and historical reporting. It runs on Next.js and PostgreSQL/PostGIS. Staff accounts are created by an administrator; there is no public registration.

## Local setup

Requirements: Node.js 22 or later and PostgreSQL 16 with PostGIS. Docker Desktop can provide the local database.

1. Copy `.env.example` to `.env` and replace the local passwords and secrets.
2. Start PostgreSQL:

   ```bash
   docker compose up -d postgres
   ```

3. Install packages and apply migrations:

   ```bash
   npm ci
   npm run db:migrate
   ```

4. Create the first administrator. The command asks for the password without displaying it:

   ```bash
   npm run admin:bootstrap -- --email admin@example.org --name "Administrator"
   ```

5. Start the app and open http://localhost:3000:

   ```bash
   npm run dev
   ```

The bootstrap command stops if an active administrator already exists. Additional staff accounts are created through the protected administrator API.

## Database commands

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:seed:phase4
```

`db:seed` adds reference values and the non-login import identity. `db:seed:phase4` resets only its named synthetic fixture records and is blocked in production. Production cannot run in demo data mode.

## Checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run audit:production
npm run scan:secrets
npm run test:performance
npm run test:automation
npm run test:automation-performance
npm run test:migration
npm run test:migration-performance
npm run test:smoke
```

The live security matrix needs a disposable PostgreSQL database whose name ends in `_test`:

```bash
SECURITY_TEST_DATABASE_URL=postgresql://user:password@localhost/provider_tracker_test npm run test:security
```

That command drops and recreates its acceptance schema in the named test database. Never point it at a working database.

The performance command also requires a disposable database ending in `_test`, with the full migration set and PostGIS. It inserts at least 10,000 synthetic facilities in one transaction and rolls the transaction back. See `docs/PERFORMANCE.md`.

Operational commands include `db:preflight`, `test:postgis`, `db:backup`, `test:restore`, `db:housekeeping`, `db:audit-integrity`, `test:load`, and `verify:release`. Each command has target guards; read the linked operations documents before using it outside a disposable environment.

Scheduled provider-work commands are `jobs:daily` and `jobs:weekly`. Run one dry check with `npm run jobs:run -- --job reverification_scan --dry-run`. Scheduling, locks, recovery, and alert rules are in `docs/AUTOMATION.md`; in-app notification behavior is in `docs/NOTIFICATIONS.md`.

## Workbook import

Administrators can use `/migration` to preview the legacy workbooks, review matches, apply an approved run, and download reconciliation issues. The screen stores file hashes and results; it does not keep uploaded workbook contents.

IT can also run a command-line preview:

```bash
npm run import:workbooks -- --admin "C:\path\URA_Provider_Availability_Tracker_ADMIN_MASTER.xlsx" --user "C:\path\URA_Provider_Availability_Tracker_USER_ACTIVE.xlsx" --output work/import-summary.json
```

After reviewing the preview, import the data:

```bash
npm run import:workbooks -- --admin "C:\path\URA_Provider_Availability_Tracker_ADMIN_MASTER.xlsx" --user "C:\path\URA_Provider_Availability_Tracker_USER_ACTIVE.xlsx" --apply
```

With no file arguments, the command looks under `reference/`. Workbook files and exports in that folder are excluded from Git. Start with `docs/MIGRATION.md`; field rules are in `docs/LEGACY_DATA_MAPPING.md`, and cutover steps are in `docs/CUTOVER.md`.

## Production

Use an external PostgreSQL/PostGIS database, run migrations as a release step, and serve the app behind HTTPS. Set every variable listed in `.env.example`; production startup rejects missing, placeholder, or non-HTTPS security settings.

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

The included `Dockerfile` builds an unprivileged runtime image without development, optional, or peer-only packages. Environment values are supplied when the container starts, not during the image build.

Start with `docs/IT_HANDOFF.md`. Deployment and rollback are in `docs/DEPLOYMENT.md`; recovery is in `docs/BACKUP_RESTORE.md`; probes, logs, metrics, and alerts are in `docs/MONITORING.md`; incident steps are in `docs/INCIDENT_RUNBOOKS.md`; and the staging gate is in `docs/STAGING_ACCEPTANCE.md`. Account procedures remain in `docs/OPERATIONS.md`. Provider history, freshness, search, and merge rules are in `docs/PROVIDER_INTELLIGENCE.md`. The access model and endpoint map are in `docs/SECURITY_ARCHITECTURE.md`.

## Product interface

The current interface rules are in `docs/DESIGN_SYSTEM.md`. The screen inventory and Figma link are in `docs/FIGMA_HANDOFF.md`. Acceptance records are in the `docs/PHASE*_ACCEPTANCE.md` files, including the staging evidence still required for legacy cutover.
