# IT Deployment Handoff

This repository has everything needed to deploy Provider Tracker. It contains fictional sample data and does not need the original workbooks at runtime.

## What IT needs

- A host that can run Docker Compose
- PostgreSQL 14 or newer with PostGIS enabled
- Redis 7 or newer
- A TLS reverse proxy or ingress
- A place to store secrets
- Database backups, logs, and monitoring

PostgreSQL/PostGIS is the supported production database. SQL Server cannot be substituted without new database and distance-search code.

## Connect the database

Create an empty PostgreSQL database and an application user, then:

1. Enable the `postgis` extension with a database administrator account.
2. Give the application user the permissions Django needs to create and use its schema.
3. Allow database traffic only from the application.
4. Require TLS for the database connection.
5. Store the password in the deployment secret store or a private `.env.production` file.

The required settings are:

```text
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_SSLMODE
```

Django migrations create the tables. Migration `0002_postgis_location` adds the geographic point and GiST index used by provider search.

## Deploy

Linux:

```bash
git clone https://github.com/Vlystudio/Provider-tracker.git
cd Provider-tracker
cp .env.production.example .env.production
# Fill in .env.production using the organization's secret process.
./scripts/deploy.sh external
```

Windows:

```powershell
Copy-Item .env.production.example .env.production
# Fill in .env.production using the organization's secret process.
.\scripts\deploy.ps1 -Mode external
```

The script checks the Compose file, builds the image, runs Django's production checks, applies migrations, starts the web and job services, and prints their status. It does not load sample accounts or sample data.

## First setup

1. Set a random `DJANGO_SECRET_KEY` with at least 50 characters.
2. Put the public hostname in `DJANGO_ALLOWED_HOSTS`.
3. Put the exact HTTPS origin in `CSRF_TRUSTED_ORIGINS`.
4. Keep `DJANGO_DEBUG=false` and `DEMO_MODE=false`.
5. Configure TLS at the reverse proxy. Only set `TRUST_PROXY_SSL_HEADER=true` when the trusted proxy replaces `X-Forwarded-Proto`.
6. Run the deployment script.
7. Create the first administrator:

   ```bash
   docker compose --env-file .env.production -f docker-compose.external-db.yml exec web python manage.py createsuperuser
   ```

8. Check that `/health/live/` and `/health/ready/` both return HTTP 200.
9. Monitor `/health/ready/` and collect the container logs.
10. Finish the organization's security, privacy, accessibility, retention, and release reviews before loading real data.

## Updates and logs

Update the application:

```bash
git pull --ff-only
./scripts/deploy.sh external
```

Check services and recent logs:

```bash
docker compose --env-file .env.production -f docker-compose.external-db.yml ps
docker compose --env-file .env.production -f docker-compose.external-db.yml logs --tail 200 web worker beat
```

Stop the containers without deleting the database:

```bash
docker compose --env-file .env.production -f docker-compose.external-db.yml down
```

## Backups and rollback

Use the organization's managed database backup service. A `pg_dump` helper is included at `scripts/backup_database.ps1`. Schedule restore tests as well as backups.

Before each release, take a verified database backup. To roll back the application, check out the last approved tag or commit and build the containers again. Database migrations are forward-oriented, so schema rollback should use a reviewed restoration plan.

## Responsibilities after handoff

The repository provides the application code, migrations, containers, health checks, tests, documentation, and configuration examples. IT is responsible for hosting, DNS, TLS certificates, network rules, database and Redis services, secrets, sign-in integration, backups, monitoring, incident response, updates, and production approval.
