# Monitoring

## Probes

`GET /api/health` is a cheap liveness probe. It confirms that the process can answer HTTP and does not query dependencies. Repeated liveness failure may restart the instance.

`GET /api/ready` checks startup state, shutdown/maintenance state, database connectivity, critical tables, PostGIS, and the geography search index. A 503 should remove the instance from new traffic; it does not automatically mean the process should restart. Use a 10-second interval, a 5-second timeout, and several consecutive failures. Do not probe readiness more often than liveness.

Maintenance mode is activated only with `APP_MAINTENANCE_MODE=on` and a controlled restart/config rollout. Health remains 200, readiness becomes 503, pages show the maintenance message, and non-probe APIs return 503. There is no bypass. Set it back to `off` and verify readiness before restoring traffic.

## Logs and correlation

Server events are one-line JSON on stdout/stderr with timestamp, level, event, release, and safe context. Incoming request IDs are ignored by default. Set `REQUEST_ID_SOURCE=trusted-proxy` only when the proxy removes caller values and supplies a bounded ID. Responses return `X-Request-ID`; use it to find the matching log event.

Central redaction removes passwords, cookies, authorization values, tokens, secrets, credential-bearing PostgreSQL URLs, and comments/notes. Do not add request bodies, raw headers, or query parameters to logs. Production rejects debug logging.

Next.js server errors pass through a vendor-neutral reporting boundary in `src/server/error-reporting.ts`. An external tracker can replace that reporter, but it may receive only correlation ID, route template, method, environment, release, safe stack, and error category—never bodies, cookies, tokens, or clinical content.

Before pilot, create one safe staging failure and retain the response request ID. Find the same ID in application stdout and the central logging destination, then confirm a related error metric exists. Record the collector query, timestamps, release, and tester. The application runtime identity must not be able to delete or rewrite the central security record.

## Metrics

Set a random `OPERATIONS_TOKEN` of at least 32 characters to enable `GET /api/metrics`. Call it with `Authorization: Bearer <token>` over the monitoring network. Without the token the endpoint returns 404. Metric labels are fixed route/operation/status categories and never include user IDs, provider IDs, email addresses, or request IDs.

Available metrics cover HTTP/proxy activity, operation and database timing histograms, operation failures, database failures, authentication results, rate-limit events, geographic searches, pool total/idle/waiting/max, and process uptime. Metrics are process-local; a multi-instance platform must scrape every instance and aggregate centrally.

## Recommended alerts

Critical (page after a sustained condition):

- readiness unavailable for all instances for 2 minutes;
- database checks unavailable for 2 minutes;
- migration, backup, or restore job failure;
- 5xx rate above 5% for 5 minutes with at least 50 requests;
- sign-in success rate near zero while attempts continue.

Warning (investigate during support coverage):

- p95 search/report latency above 2 seconds for 15 minutes;
- pool waiting above zero for 10 minutes or total at 90% of configured max;
- failed sign-ins or rate-limit blocks exceed the established staging baseline by 3× for 15 minutes;
- last verified backup older than 26 hours;
- database storage above 75% or rapid week-over-week growth.

Tune thresholds after two to four weeks of staging/production baseline data. Do not page on one failed request.

Exercise the application-unavailable, readiness, database, scheduler, sustained-error, repeated-sign-in-failure, and suspicious privileged-access alerts with safe staging conditions. Record trigger time, threshold, delivery time, destination, owner, ticket, and closure. Classify each rule as immediate page, urgent ticket/message, daily review, or dashboard only. Review false positives during the pilot before changing a threshold.

## PostgreSQL monitoring

Leave autovacuum enabled. Monitor connections, long transactions, dead tuples, disk growth, replication/PITR health, and index size. Run `ANALYZE` after large imports. Enable `pg_stat_statements` where supported and review total time, mean time, calls, and rows for high-value queries. Infrastructure may set a slow statement threshold, but logs must not include sensitive parameter values. Do not log all SQL parameters at the application layer.

Security monitoring should cover repeated failed sign-ins, rate-limit blocks, forbidden administrator requests, role changes, mass deactivation, and unusual mutation volume. This is operational security monitoring, not user profiling.
