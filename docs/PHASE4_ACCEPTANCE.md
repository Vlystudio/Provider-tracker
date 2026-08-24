# Phase 4 acceptance

Status: **COMPLETE WITH NON-BLOCKING FOLLOW-UP**

Provider verification history, failed-contact tracking, freshness, reverification work, provider search, data-quality review, duplicate handling, reporting, and guarded test fixtures are implemented. The remaining checks need an IT-managed PostgreSQL instance with PostGIS.

## Completed checks

| Check | Result |
| --- | --- |
| ESLint | Passed |
| TypeScript | Passed |
| Unit and component tests | 74 passed in 16 files |
| Production build | Passed; all application pages and API routes compiled |
| Security acceptance | 47 of 47 scenarios passed |
| Browser: provider search | Passed; filters returned the expected facility and result count |
| Browser: report drill-down | Passed; a summary card opened its underlying facility list |
| Browser: review queue | Passed; highest priority appears first |
| Browser: narrow-window menu | Passed; the menu opens, receives focus, and closes with Escape |
| Browser: error overlay and layout | Passed; no application error overlay or horizontal page overflow |
| Repository term scan | Passed; no public references to coding assistants or prior versions |

The browser extension logged two failed requests from its own `ag-scripts.js`. That script is not present in this repository, and no application-origin console error was found.

## Visual review record

1. [Provider search](../screenshots/phase4-audit/01-provider-search.png) — Healthy. Filters, explanations, status, freshness, distance, coordinate quality, and contact details are visible in one table.
2. [Reverification queue](../screenshots/phase4-audit/02-review-queue.png) — Healthy. Priority order, reason, freshness, and assignment are easy to scan.
3. [Reports](../screenshots/phase4-audit/03-reports.png) — Healthy. Every percentage includes its denominator, with activity and specialty coverage below.
4. [Data quality](../screenshots/phase4-audit/04-data-quality.png) — Healthy. Totals link to concrete issue lists, and overlapping issues remain visible.
5. [Duplicate review](../screenshots/phase4-audit/05-duplicate-review.png) — Healthy. Both records and the matching evidence are shown side by side.
6. [Narrow-window navigation](../screenshots/phase4-audit/06-narrow-window-menu.png) — Historical check. The menu is hidden by default, covers the page only while open, and supports keyboard dismissal. This viewport is no longer a supported product target.

The screenshots confirm visible hierarchy, layout, labels, and basic keyboard behavior. They do not by themselves establish full WCAG conformance or screen-reader compatibility.

## Staging checks for IT

The local test server has PostgreSQL but does not have the PostGIS extension. The migration and performance scripts stop safely when PostGIS is missing, so no geographic timing is claimed from this machine.

Run these checks against a disposable staging clone with the full production extensions:

1. Install PostGIS and apply `drizzle/0006_strange_wendell_vaughn.sql`.
2. Confirm the migration backfills verification history, specialties, diagnosis capabilities, and coordinate provenance as documented in [Provider intelligence](PROVIDER_INTELLIGENCE.md).
3. Run `npm run db:seed:phase4` only in an approved non-production environment.
4. Run `npm run test:performance` and save the `EXPLAIN (ANALYZE, BUFFERS)` output.
5. Confirm the radius-search and reporting plans use the indexes listed in [Performance](PERFORMANCE.md).
6. Complete keyboard, zoom/reflow, screen-reader, and contrast testing under the organization’s accessibility process.
7. Review the updated [Figma handoff](FIGMA_HANDOFF.md) if the design team maintains a source file.

No external Figma file was changed because no connected source file was supplied. No production data, credentials, or default accounts were added. The temporary browser-review account and its credential file were removed after verification.
