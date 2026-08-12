# Deployment

## Local company demonstration

Run `scripts/setup_demo.ps1` and `scripts/run_demo.ps1`. SQLite and eager tasks are the defaults. The local server binds to `127.0.0.1:8000` and should not be exposed to an untrusted network.

## Production-style containers

1. Create a private environment file from `.env.example`.
2. Generate a long random `DJANGO_SECRET_KEY`.
3. Set a strong unique `POSTGRES_PASSWORD`.
4. Set the exact public `DJANGO_ALLOWED_HOSTS` and trusted origins.
5. Terminate TLS at a reviewed reverse proxy and enable secure redirect.
6. Run `docker compose up --build`.
7. Create real staff identities; never run `seed_demo`.
8. Configure encrypted backups, monitoring, log retention, and alert delivery.

The stack starts PostGIS, Redis, web, Celery worker, and Celery Beat services. Web startup applies migrations before Gunicorn begins serving.

The selected PostGIS 18 image uses the PostgreSQL 18 data-volume path `/var/lib/postgresql`; changing it back to the pre-18 `/var/lib/postgresql/data` path will prevent the intended named-volume behavior.

## Database behavior

`DB_ENGINE=postgis` switches Django to PostgreSQL. Migration `0002_postgis_location` installs PostGIS, adds a stored geography point, and creates a GiST spatial index. Radius search uses `ST_DWithin` and `ST_Distance` without changing the form or response contract.

## Pre-deployment checks

Run Django checks, migration consistency, tests, static collection, dependency audit, and a secret scan. Then validate HTTPS, secure cookies, role access, database restore, worker retries, task idempotency, file intake limits, error pages, audit retention, and production refusal of demo login.
