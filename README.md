# Provider Tracker

Internal web app for URA provider calls, availability checks, follow-up, and reporting. The current version includes the database schema, workbook importer, staff screens, and sample data used for local testing.

## Quick start

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL/PostGIS locally:
   ```bash
   docker compose up -d postgres
   ```
3. Install dependencies (if you have not already):
   ```bash
   npm install
   ```
4. Run the app:
   ```bash
   npm run dev
   ```
5. Open http://localhost:3000

## Database and migrations

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

## Tests

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Import the existing workbooks

The import command reads the two existing workbooks without changing them. Run a preview first:

Preview the real workbooks without a database write:

```bash
npm run import:workbooks -- --admin "C:\path\URA_Provider_Availability_Tracker_ADMIN_MASTER.xlsx" --user "C:\path\URA_Provider_Availability_Tracker_USER_ACTIVE.xlsx" --output work/import-summary.json
```

After reviewing the preview, import the data into PostgreSQL:

```bash
npm run import:workbooks -- --admin "C:\path\URA_Provider_Availability_Tracker_ADMIN_MASTER.xlsx" --user "C:\path\URA_Provider_Availability_Tracker_USER_ACTIVE.xlsx" --apply
```

With no file arguments, the command looks under `reference/`. Workbook files and exports in that folder are not committed to Git. See `docs/IMPORTING_WORKBOOKS.md` for the matching and rejection rules.

## Implementation status

Working now:

- staff dashboard and workflow screens
- PostgreSQL/PostGIS schema, migrations, and sample records
- provider availability rules and recommendations
- workbook preview and import commands
- unit tests for business rules and import matching

Still needed before launch:

- sign-in and role permissions
- database-backed write screens
- browser and accessibility tests
- production deployment review
