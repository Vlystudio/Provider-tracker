# Architecture

## Runtime modes

Local demonstration mode uses Django, SQLite, server-rendered templates, static assets, and eager Celery execution. It requires no Docker, Redis, or external database.

Production-style mode uses Django/Gunicorn, PostgreSQL with PostGIS, Redis, Celery workers, and Celery Beat. The container stack is an implementation reference and still requires organizational hardening.

## Application layers

- `apps/accounts`: user profiles, URA initials, and role-to-group synchronization.
- `apps/tracker/models.py`: normalized persistence and indexes.
- `apps/tracker/forms.py`: input validation, clinical search constraints, duplicate overrides, and safe uploads.
- `apps/tracker/services`: versioned business rules, transactions, importer, distance search, reports, and automations.
- `apps/tracker/selectors.py`: bounded read queries, prefetching, filtering, and ordering.
- `apps/tracker/views.py`: permission-protected request coordination.
- `templates` and `static`: semantic, responsive presentation with HTMX enhancement and graceful full-page fallback.

Models do not contain reporting queries. Templates do not calculate business outcomes. Browser previews improve speed but server-side saves always recalculate canonical results.

## Distance repository

SQLite looks up a stored ZIP centroid, computes a latitude/longitude bounding box, limits candidates, and applies a tested Haversine calculation before sorting.

PostgreSQL stores a generated `geography(Point, 4326)` column derived from latitude/longitude, indexes it with GiST, filters with `ST_DWithin`, and returns miles from `ST_Distance`. Both paths implement the same search contract.

## Automation

Each rule creates an `AutomationRun` with a schedule-window idempotency key. Demo actions execute eagerly. Production workers consume Redis jobs, while Beat evaluates enabled rules. Expensive imports and report generation can move behind the same task boundary without changing views.

## Request flow

1. Authentication establishes a Django session.
2. Role decorators protect the view; navigation hides destinations outside the role.
3. A form normalizes and validates input.
4. A service performs business calculations and transactional writes.
5. Review, duplicate, report, and audit records update from canonical data.
6. A template renders bounded results or a safe empty/error state.
