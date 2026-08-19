# Architecture

## Overview

This project is a Next.js App Router application that centralizes URA provider-availability workflows into a single canonical database and interface. It replaces the spreadsheet model with a normalized PostgreSQL/PostGIS foundation and business logic that is versioned and testable.

## Runtime components

- Next.js app server for authenticated views and server actions
- PostgreSQL with PostGIS for operational storage and geospatial filtering
- Drizzle ORM for typed schema and SQL migrations
- Auth.js for session-based RBAC
- Worker process for import, export, snapshot generation, and background jobs
- Docker Compose for local orchestration

## Application layers

### Presentation

- dashboard and summary pages
- rapid call-entry form
- provider search page
- authorization narrative preview
- admin review and facility workflows
- reports and audit screens

### Domain

- provider-search validation
- result-phrase rules
- review-queue logic
- duplicate detection
- FDM eligibility
- narrative-generation rules

### Data access

- Drizzle queries for calls, facilities, mappings, and reports
- PostgreSQL views and summary tables for current state
- materialized summaries for reporting workloads
- audit rows for every mutation

### Workbook migration

- bounded ZIP/XML streaming reader; no Excel formula engine or workbook recalculation
- header-name mapping to tolerate the admin/user column drift
- raw and normalized row staging with source hash, sheet, and row provenance
- canonical rule recalculation instead of trusting cached output phrases
- deterministic fingerprints for batch and call idempotency
- reconciliation before any database write; redacted JSON summaries are safe to share internally

## Design principles

- never trust workbook formula output as the system-of-record
- normalize aliases and preserve raw source values
- enforce RBAC on the server, not only in the UI
- keep derived state queryable rather than stored as spreadsheet formulas
- use indexed geospatial queries instead of row-by-row client processing
- keep source workbooks read-only and outside version control

## Future migration path

The application is intentionally designed for 100,000+ payment and operational records and a path to 1,000,000 records through server-side pagination, summary tables, and query planning discipline.
