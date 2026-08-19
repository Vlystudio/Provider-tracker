# Architecture

## Runtime

- Next.js 16 App Router on Node.js 22
- React server components for pages and route handlers for HTTP APIs
- Better Auth for email/password identity and database-backed sessions
- Drizzle ORM for typed data access and migrations
- PostgreSQL with PostGIS for operational and geospatial data
- local workbook import command for controlled data intake

## Request path

Browser requests pass through the Next.js proxy, then the page or route handler, the central authorization helper, the service layer, Drizzle, and PostgreSQL. Page checks keep users out of routes they cannot use. Route and service checks remain the security boundary for direct HTTP requests.

## Application areas

- dashboard and summary pages
- call entry and call history
- provider search
- authorization summaries and review queue
- facility maintenance
- reports and audit views
- administrator account and data operations

## Data rules

- workbook formulas are not treated as source data
- aliases are normalized while raw source values remain available for reconciliation
- derived results come from versioned business rules
- provider distance filtering uses indexed PostGIS queries
- source workbooks stay read-only and outside version control

The detailed trust boundaries, permissions, and endpoint rules are in `SECURITY_ARCHITECTURE.md`.
