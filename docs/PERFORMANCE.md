# Performance checks

## Representative dataset

Run `npm run test:performance` against a disposable PostgreSQL/PostGIS database whose name ends in `_test`. The command opens one transaction, inserts synthetic records, runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, prints the timings, and rolls the transaction back.

The fixture contains:

- 5,000 facilities
- 5,000 specialty relationships
- 5,000 diagnosis relationships
- 50,000 verification events
- roughly 2,500 failed contact attempts
- address-level coordinates around the 04103 origin

The query set covers the facility directory, 50-mile radius search, reverification queue, facility history, historical report, and duplicate candidate block.

## Local targets

| Path | Target |
| --- | ---: |
| Facility directory | 150 ms |
| 50-mile radius search | 250 ms |
| Reverification queue | 200 ms |
| Facility detail history | 100 ms |
| Historical report | 300 ms |
| Duplicate candidate block | 500 ms |

These are development targets, not production service-level guarantees. IT should capture staging plans and timings with the expected database size, hardware, connection latency, and statistics.

## Required indexes

Phase 4 adds or uses indexes for:

- facility geography cast to PostGIS geography
- active facility and verification date
- accepting status and accepting verification date
- facility-specialty search and freshness
- diagnosis status search and freshness
- facility verification history
- contact history and outcome
- duplicate decision/confidence/score
- open reverification assignment

Do not accept the benchmark solely from wall-clock output. Check the plan for sequential scans on large filtered relations, row-estimate errors, disk reads, and unnecessary nested loops.
