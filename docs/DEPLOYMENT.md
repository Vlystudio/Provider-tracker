# Deployment

## Local demo

Run `scripts/setup_demo.ps1` and then `scripts/run_demo.ps1`. The demo uses SQLite and runs background jobs immediately. It listens on `127.0.0.1:8000` and should not be exposed to an untrusted network.

## Production containers

1. Copy `.env.production.example` to a private `.env.production` file.
2. Generate a long random `DJANGO_SECRET_KEY`.
3. Add the PostgreSQL/PostGIS connection values supplied by IT.
4. Set the exact public values for `DJANGO_ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS`.
5. Terminate TLS at a reviewed reverse proxy and set proxy trust carefully.
6. Run `./scripts/deploy.sh external` or `.\scripts\deploy.ps1 -Mode external`.
7. Create staff accounts. Do not run `seed_demo` in production.
8. Configure encrypted backups, monitoring, log retention, and alerts.

The application-only Compose file starts Redis, the web service, a Celery worker, and Celery Beat, then connects them to IT's database. The deployment script runs production checks and migrations before starting Gunicorn. `/health/live/` checks the web process, and `/health/ready/` checks the database connection.

See [IT Deployment Handoff](IT_HANDOFF.md) for complete setup and maintenance steps. `docker-compose.yml` is a self-contained evaluation setup that also includes PostGIS.

The bundled PostGIS 18 image uses `/var/lib/postgresql` for its data volume. Do not change it to `/var/lib/postgresql/data`.

## Database setup

Set `DB_ENGINE=postgis` to use PostgreSQL. The database must have PostGIS available. Migration `0002_postgis_location` enables the extension, adds the stored geographic point, and creates a GiST index. Provider search then uses `ST_DWithin` and `ST_Distance`.

## Checks before release

Run the Django checks, migration check, tests, static-file collection, dependency audit, and secret scan. Also test HTTPS, cookies, role access, database restore, worker retries, repeated job runs, upload limits, error pages, history retention, and the production block on demo sign-in.
