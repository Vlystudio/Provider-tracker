# Staging acceptance

Use an isolated staging environment with dedicated fixture accounts and no production credentials or member data. Record command output, release, database name, operator, date, and ticket.

## PostGIS and migration gate

```bash
export DATABASE_URL='<staging migration connection>'
export TARGET_ENVIRONMENT=staging
export CONFIRM_DATABASE='<exact database name>'
npm run db:preflight
npm run db:migrate
npm run test:postgis
```

Expected PostGIS result is JSON with `status: PASS`, two point columns with enforced SRID 4326 constraints, `facilities_geog_gist`, `facilities_geography_gist`, `postal_code_centroids_geog_gist`, a 9.9-mile point inside, a 10.1-mile point outside, and null coordinates excluded. Distance inputs use miles × 1609.344 meters. Creating the extension requires the DBA/managed-service role; the runtime role does not need extension privileges.

Then use a disposable fully migrated database ending in `_test`:

```bash
BENCHMARK_FACILITIES=10000 BENCHMARK_SAMPLES=5 npm run test:performance
```

The benchmark rolls back its fixtures and reports median, p95, returned rows, root plan, and indexes for 10/25/50/100-mile, specialty, diagnosis, accepting, freshness, and recommended-ranking searches. Capture a 50,000-facility run when staging capacity allows. Investigate missing geography index use or p95 above the broad 1.5-second staging guardrail.

## Restore gate

- [ ] latest approved backup checksum matches
- [ ] restore completes into a clean isolated database
- [ ] critical row counts and relationships match
- [ ] `npm run test:postgis` passes against the restored database
- [ ] application starts and becomes ready against the restore
- [ ] authentication, provider search, reports, audit, and fixture mutation pass

Run the automated test against a disposable source first: `npm run test:restore`.

## Application gate

Run `SMOKE_BASE_URL=https://<staging-host> npm run test:smoke`, then configure the variables required by `npm run test:staging`:

- `STAGING_DATABASE_URL`
- `STAGING_MUTATION_FACILITY_ID` for a disposable provider fixture
- `STAGING_URA_EMAIL` / `STAGING_URA_PASSWORD`
- `STAGING_AUDITOR_EMAIL` / `STAGING_AUDITOR_PASSWORD`
- `STAGING_ADMIN_EMAIL` / `STAGING_ADMIN_PASSWORD`

The suite verifies login, URA access, provider radius search, report load, auditor/admin access, authorization boundaries, one safe contact-attempt fixture write, matching audit request ID, PostGIS ordering, logout, and session revocation.

Additional checklist:

- [ ] HTTPS redirect, certificate, host/protocol forwarding, and secure cookie verified
- [ ] health and readiness probe behavior verified independently
- [ ] maintenance mode removes traffic and leaves liveness healthy
- [ ] metrics scrape and structured log collection reach IT monitoring
- [ ] alert test reaches the correct non-production destination
- [ ] `npm run db:housekeeping` dry-run reviewed; no history tables selected
- [ ] `npm run db:audit-integrity` passes
- [ ] bounded load test passes with approved staging authorization
- [ ] deployment and application rollback are rehearsed

Do not approve production while any required staging line is unexecuted. Repository availability is not infrastructure approval.
