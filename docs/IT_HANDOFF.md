# IT Deployment Handoff

This repository is the complete deployable application. It is MIT-licensed, contains only fictional demonstration data, and does not depend on private workbooks at runtime. The application owner does not need to operate the infrastructure. IT can clone the repository, provide production configuration, connect the database, and deploy it using standard container tooling.

## Supported production topology

- Django/Gunicorn web container
- Celery worker and scheduler containers
- PostgreSQL 14 or newer with the PostGIS extension enabled
- Redis 7 or newer
- organization-managed TLS reverse proxy or ingress
- organization-managed identity, secrets, monitoring, backup, and recovery controls

PostgreSQL/PostGIS is the supported SQL backend. Microsoft SQL Server is not a drop-in substitute because geographic search and migrations use PostGIS. Supporting SQL Server would require a separately reviewed database adapter and spatial-query implementation.

## Fastest IT deployment

The application-only Compose file is intended for an organization-managed PostgreSQL/PostGIS database:

```bash
git clone https://github.com/Vlystudio/Provider-tracker.git
cd Provider-tracker
cp .env.production.example .env.production
# Fill in .env.production using the organization's secret-management process.
./scripts/deploy.sh external
```

Windows deployment hosts can run:

```powershell
Copy-Item .env.production.example .env.production
# Fill in .env.production using the organization's secret-management process.
.\scripts\deploy.ps1 -Mode external
```

The script validates the Compose configuration, builds the image, runs Django's production checks, applies database migrations, starts the services, and prints service status. It never loads demo accounts or fictional seed data.

## Database contract

IT supplies an empty PostgreSQL database and an application login. Before first deployment:

1. Enable the `postgis` extension in the target database using a database administrator account.
2. Grant the application login connect, schema usage/create, and table/sequence privileges needed for Django migrations and normal reads/writes.
3. Restrict inbound database networking to the application runtime.
4. Require TLS and set `POSTGRES_SSLMODE=require` or `verify-full` according to organizational policy.
5. Put the password in the deployment platform's secret store or the private `.env.production` file; never commit it.

The application uses these variables: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_SSLMODE`. Django migrations own the application schema. The generated geographic point and GiST index are created by migration `0002_postgis_location`.

## First deployment checklist

1. Set a random `DJANGO_SECRET_KEY` of at least 50 characters.
2. Set the exact public hostname in `DJANGO_ALLOWED_HOSTS`.
3. Set the exact HTTPS origin in `CSRF_TRUSTED_ORIGINS`.
4. Keep `DJANGO_DEBUG=false` and `DEMO_MODE=false`.
5. Configure TLS at the reverse proxy. Set `TRUST_PROXY_SSL_HEADER=true` only when that trusted proxy overwrites `X-Forwarded-Proto`.
6. Run the deployment script.
7. Create the first administrator:

   ```bash
   docker compose --env-file .env.production -f docker-compose.external-db.yml exec web python manage.py createsuperuser
   ```

8. Verify `/health/live/` returns HTTP 200 and `/health/ready/` returns HTTP 200.
9. Configure monitoring against `/health/ready/` and centralized collection of container stdout/stderr.
10. Complete organizational security, privacy, accessibility, retention, and production-approval reviews before loading operational data.

## Routine operations

Upgrade:

```bash
git pull --ff-only
./scripts/deploy.sh external
```

View status and logs:

```bash
docker compose --env-file .env.production -f docker-compose.external-db.yml ps
docker compose --env-file .env.production -f docker-compose.external-db.yml logs --tail 200 web worker beat
```

Stop without deleting data:

```bash
docker compose --env-file .env.production -f docker-compose.external-db.yml down
```

Database backups should use the organization's managed backup service. A `pg_dump` helper is also provided at `scripts/backup_database.ps1`; restore tests must be scheduled and documented by IT.

## Rollback

Application rollback is performed by checking out the previously approved Git tag or commit and creating the containers again. Database migrations are forward-oriented; take a verified database backup before every release and have a reviewed data-restoration plan before rolling back a schema-changing release.

## Owner handoff boundary

The repository supplies application code, schema migrations, container definitions, health endpoints, tests, documentation, and safe configuration examples. IT owns hosting, DNS, certificates, network controls, database and Redis services, secrets, identity integration, backups, monitoring, incident response, upgrades, and production authorization. No private workbook or operational record is required to evaluate or deploy the code.
