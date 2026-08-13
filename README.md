# Provider Tracker

Provider Tracker is a Django site for recording provider availability calls. Staff can search facilities, add call results, follow up on open items, and run reports from one database.

This public repository contains fictional sample data only. Do not add real member information, authorization records, call notes, workbooks, credentials, or database exports to the repository.

![Provider Tracker dashboard](screenshots/dashboard.png)

<details>
<summary>More screenshots</summary>

![Provider search](screenshots/provider-search.png)

![New provider call](screenshots/new-call.png)

![Authorization summary](screenshots/authorization-summary.png)

</details>

## What the site does

- Records an authorization and provider call together.
- Calculates the call result and next review date on the server.
- Searches facilities by ZIP, distance, diagnosis, or specialty.
- Flags repeat calls for the same facility and diagnosis in one week.
- Keeps follow-up tasks in a review queue.
- Shows authorization summaries and recent facility calls.
- Filters and exports the call log.
- Builds date-based reports and saves report snapshots.
- Previews supported Excel workbooks before importing them.
- Keeps a history of important changes.
- Limits pages and actions by user role.

## Project layout

- Django 6.1 serves the pages and handles validation.
- SQLite is used for the local demo.
- PostgreSQL with PostGIS is used in production for distance searches.
- Redis and Celery run scheduled jobs in production.
- Docker files and setup scripts are included for IT deployment.

More detail is in [Architecture](docs/ARCHITECTURE.md) and [Data Model](docs/DATA_MODEL.md).

## Run the local demo on Windows

You need PowerShell and Python 3.14, or another supported Python version.

```powershell
git clone https://github.com/Vlystudio/Provider-tracker.git "D:\Provider tracker Database"
Set-Location "D:\Provider tracker Database"
.\scripts\setup_demo.ps1
.\scripts\run_demo.ps1
```

Open <http://127.0.0.1:8000>.

| Role | Username | Password |
|---|---|---|
| URA User | `ura.demo` | `DemoOnly!2026` |
| Administrator | `admin.demo` | `DemoOnly!2026` |
| Report Viewer | `viewer.demo` | `DemoOnly!2026` |
| Auditor | `auditor.demo` | `DemoOnly!2026` |

The demo buttons are available only when `DJANGO_DEBUG=true` and `DEMO_MODE=true`. The production settings will not start if demo sign-in is enabled.

Reset the sample database with:

```powershell
.\scripts\reset_demo.ps1
```

## Give the project to IT

The repository includes the application, database migrations, Docker files, environment examples, health checks, tests, and deployment scripts. IT can connect its own PostgreSQL/PostGIS database and deploy the site without the sample workbooks.

Basic Linux deployment with an IT-managed database:

```bash
git clone https://github.com/Vlystudio/Provider-tracker.git
cd Provider-tracker
cp .env.production.example .env.production
# Add the database connection, public URL, and secrets to .env.production.
./scripts/deploy.sh external
```

Windows deployment:

```powershell
Copy-Item .env.production.example .env.production
# Add the database connection, public URL, and secrets to .env.production.
.\scripts\deploy.ps1 -Mode external
```

See [IT Deployment Handoff](docs/IT_HANDOFF.md) for the database requirements, first setup, updates, backups, and rollback notes. A self-contained evaluation stack is also available with `./scripts/deploy.sh bundled`.

## Import a workbook

Workbook files are not stored in this repository. The importer checks the file structure, size, sheets, rows, and duplicates before changing the database. A preview does not write any records.

Preview two workbooks:

```powershell
.\.venv\Scripts\python.exe manage.py import_ura_workbooks `
  --admin "C:\path\URA_Provider_Availability_Tracker_ADMIN_MASTER.xlsx" `
  --user "C:\path\URA_Provider_Availability_Tracker_USER_ACTIVE.xlsx" `
  --preview
```

Import after reviewing the preview:

```powershell
.\.venv\Scripts\python.exe manage.py import_ura_workbooks `
  --admin "C:\path\admin.xlsx" `
  --user "C:\path\user.xlsx" `
  --apply
```

See [Workbook Analysis](docs/WORKBOOK_ANALYSIS.md) and [Import Process](docs/IMPORT_PROCESS.md) for supported sheets and import rules.

## Run the checks

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\ruff.exe format --check .
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check
.\.venv\Scripts\python.exe manage.py collectstatic --noinput
.\.venv\Scripts\pip-audit.exe -r requirements.txt
```

GitHub Actions runs these checks on pushes and pull requests.

## Before production use

The code includes role checks, upload validation, secure session defaults, audit records, redacted logs, and health endpoints. Those features do not by themselves make a deployment HIPAA compliant or approved by an organization.

Before using real data, IT must review privacy, security, identity, access, backups, monitoring, retention, incident response, and the production environment. Read [Security Notes](docs/SECURITY.md) and the [Security Policy](SECURITY.md).

## Contributing and license

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) first.

Provider Tracker is available under the [MIT License](LICENSE).
