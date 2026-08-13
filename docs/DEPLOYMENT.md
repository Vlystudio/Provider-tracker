# Deployment

## Local company demonstration

Run `scripts/setup_demo.ps1` and `scripts/run_demo.ps1`. SQLite and eager tasks are the defaults. The local server binds to `127.0.0.1:8000` and should not be exposed to an untrusted network.

## Production containers

1. Create a private `.env.production` file from `.env.production.example`.
2. Generate a long random `DJANGO_SECRET_KEY`.
3. Supply the organization-managed PostgreSQL/PostGIS connection values.
4. Set the exact public `DJANGO_ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS`.
5. Terminate TLS at a reviewed reverse proxy and configure proxy trust deliberately.
6. Run `./scripts/deploy.sh external` or `.\scripts\deploy.ps1 -Mode external`.
7. Create real staff identities; never run `seed_demo`.
8. Configure encrypted backups, monitoring, log retention, and alert delivery.

The application-only stack starts Redis, web, Celery worker, and Celery Beat services and connects them to IT's database. The deployment script runs production checks and applies migrations before starting Gunicorn. `/health/live/` checks the web process and `/health/ready/` checks database connectivity.

See [IT Deployment Handoff](IT_HANDOFF.md) for the full operator contract. `docker-compose.yml` remains available as a self-contained evaluation stack that includes PostGIS.

The bundled PostGIS 18 image uses the PostgreSQL 18 data-volume path `/var/lib/postgresql`; changing it to `/var/lib/postgresql/data` will prevent the intended named-volume behavior.

## Database behavior

`DB_ENGINE=postgis` switches Django to PostgreSQL. IT must make the PostGIS extension available. Migration `0002_postgis_location` ensures the extension exists, adds a stored geography point, and creates a GiST spatial index. Radius search uses `ST_DWithin` and `ST_Distance` without changing the form or response contract.

## Pre-deployment checks

Run Django checks, migration consistency, tests, static collection, dependency audit, and a secret scan. Then validate HTTPS, secure cookies, role access, database restore, worker retries, task idempotency, file intake limits, error pages, audit retention, and production refusal of demo login.
