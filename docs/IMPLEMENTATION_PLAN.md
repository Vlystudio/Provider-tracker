# Implementation Plan

## Phase 1 — foundation

- [x] Initialize a Next.js App Router project with TypeScript and Tailwind.
- [x] Configure Docker Compose for PostgreSQL/PostGIS and the local app service.
- [x] Add Drizzle schema, migrations, environment configuration, and deterministic seed.
- [x] Add server-backed authentication, RBAC, and database sessions.
- [x] Define UI shell, tokens, and app navigation.
- [x] Add audit, logging, and redaction helpers.

## Phase 2 — migration and master data

- [x] Add workbook intake and hashing utilities with read-only `reference/` handling.
- [x] Stage workbook rows and identify real vs. scaffold data.
- [x] Normalize aliases and facility/master-data reconciliation.
- [x] Implement importer preview, idempotent apply, and batch reconciliation.
- [ ] Publish admin reconciliation and data-quality pages.

## Phase 3 — core user workflows

- [ ] Build authorization session and rapid call-entry flow.
- [ ] Add call log with server-side filtering and detail drawer.
- [ ] Implement provider search with PostGIS radius filtering.
- [ ] Generate authorization narratives from canonical call history.

## Phase 4 — admin and reporting

- [ ] Add review queue, facility merge, and master-data editors.
- [ ] Build weekly, monthly, and all-time reports from database summaries.
- [ ] Implement scheduling trend and duplicate monitoring.
- [ ] Add report snapshots and exports.

## Phase 5 — hardening

- [ ] Add benchmark seed and performance testing.
- [ ] Verify query plans and tune indexes.
- [ ] Complete E2E, accessibility, and permission tests.
- [x] Finalize security and operations guidance.

## Current status

The database, workbook intake, authentication, authorization, and deployment safeguards are in place. Remaining product work is tracked by the unchecked workflow items above.
