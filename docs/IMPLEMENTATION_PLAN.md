# Implementation plan

## Foundation

- [x] Configure Next.js, TypeScript, PostgreSQL/PostGIS, and migrations.
- [x] Add database-backed authentication, role permissions, and sessions.
- [x] Define the shared application shell and interface patterns.
- [x] Add structured audit events, safe errors, and security headers.

## Workbook intake and master data

- [x] Parse workbook sources without changing them.
- [x] Normalize aliases and reconcile facility master records.
- [x] Add idempotent preview/apply behavior and row-level provenance.
- [x] Keep newer verified contact and relationship values ahead of older imports.
- [x] Publish data-quality and duplicate-review pages.

## Provider workflows

- [x] Add searchable, paged facility records and facility history.
- [x] Implement PostGIS radius filtering with coordinate-quality disclosure.
- [x] Add specialty and explicit-positive diagnosis filtering.
- [x] Add partial verification and failed-contact recording.
- [x] Add deterministic result ranking and reverification priority.
- [x] Add optimistic conflict detection.

## Data quality and reporting

- [x] Add deterministic quality checks and actionable issue groups.
- [x] Add duplicate decisions and safe facility merge.
- [x] Preserve verification, contact, call, relationship, and audit history.
- [x] Build period reports from verification and contact history.
- [x] Add availability changes, contact trend, freshness, denominator detail, drill-down, and specialty coverage.

## Hardening

- [x] Add guarded development fixtures and rollback-only performance testing.
- [x] Add query-plan targets and required indexes.
- [x] Extend permission and security regression tests to provider intelligence.
- [x] Document migration, operations, PostGIS, and staging checks.

## Current status

The application work is in place. IT still owns staging migration validation, production PostGIS, credentials, HTTPS, backups, monitoring, retention approval, and deployment approval.
