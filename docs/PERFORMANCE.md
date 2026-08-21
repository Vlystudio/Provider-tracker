# Performance checks

## Geographic benchmark

Run `npm run test:performance` against a disposable PostgreSQL/PostGIS database whose name ends in `_test`. The command opens one transaction, inserts representative synthetic records, runs repeated `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` samples, prints results, and rolls everything back.

Defaults:

- 10,000 facilities spread up to roughly 100 miles from the 04103 origin;
- 10,000 specialty relationships;
- 10,000 diagnosis relationships;
- 100,000 verification-history records;
- five timed samples per query.

Set `BENCHMARK_FACILITIES=50000` for the larger staging run and `BENCHMARK_SAMPLES` from 3 through 10. The query set covers 10/25/50/100-mile radii, specialty + radius, diagnosis + radius, accepting + radius, freshness + radius, and recommended ranking under a radius constraint.

Output includes median, p95, returned rows, root plan, and index names. The broad p95 guardrail is 1.5 seconds per query so CI catches major regressions without relying on brittle workstation timings. It is not a production service-level guarantee.

## Review

Require the `facilities_geography_gist` expression index for `geog_point::geography` radius filters. Also review specialty/diagnosis join indexes, accepting/freshness indexes, row-estimate errors, disk reads, spills, and unnecessary nested loops. A passing wall-clock number with the wrong plan is not sufficient.

Application histograms cover provider search, report generation, reverification queue work, and database checks. Run the bounded HTTP test only against local or explicitly approved staging targets:

```bash
LOAD_BASE_URL=http://127.0.0.1:3000 LOAD_REQUESTS=100 LOAD_CONCURRENCY=10 npm run test:load
```

The script caps traffic at 500 requests and 25 workers, reporting error rate, p50, and p95 for health, readiness, sign-in, session, and provider-page paths. For production capacity planning, IT must repeat representative authenticated tests in staging while watching CPU, memory, database connections, pool waiting, and PostgreSQL query statistics.

## Automation benchmark

Run `npm run test:automation-performance` against a disposable database whose name ends in `_test`. It creates temporary tables, uses at least 10,000 synthetic facilities, measures the main scheduled-query shapes, and rolls back. Set `AUTOMATION_BENCHMARK_SIZE` up to 50,000 for a larger staging run.

The local 10,000-facility run on 2026-08-21 measured 20.2 ms for the stale scan, 2.9 ms for quality, 28.2 ms for duplicate detection, 0.8 ms for coverage evaluation, 1.4 ms for digest generation, and 2.6 ms for 1,000 notification inserts. The local coverage case measures the indexed non-spatial filters. Staging must repeat coverage work with PostGIS distance filtering.
