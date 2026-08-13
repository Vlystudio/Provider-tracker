# Architecture

## Local and production setups

The local demo uses Django, SQLite, server-rendered templates, static files, and immediate execution of background jobs. It does not require Docker, Redis, or an external database.

Production uses Django with Gunicorn, PostgreSQL/PostGIS, Redis, Celery workers, and Celery Beat. The application-only Compose file connects to a database managed by IT. A bundled Compose file is also available for evaluation.

## Main code areas

- `apps/accounts`: user profiles, URA initials, roles, and Django groups
- `apps/tracker/models.py`: database tables and indexes
- `apps/tracker/forms.py`: form and upload validation
- `apps/tracker/services`: business rules, database writes, imports, distance search, reports, and scheduled jobs
- `apps/tracker/selectors.py`: filtered and ordered database queries
- `apps/tracker/views.py`: page requests and permission checks
- `templates` and `static`: HTML, CSS, JavaScript, and HTMX page updates

Reporting queries stay out of the models, and templates do not calculate call results. The browser shows a result preview, but the server calculates it again before saving.

## Distance search

SQLite starts with a stored ZIP centroid, narrows the facilities with a latitude/longitude box, calculates Haversine distance, and sorts the results.

PostgreSQL stores a generated `geography(Point, 4326)` value with a GiST index. It uses `ST_DWithin` to filter and `ST_Distance` to return miles. Both database paths follow the same search rules.

## Scheduled jobs

Each job creates an `AutomationRun` with a key for its schedule period. Demo actions run immediately. Production workers take jobs from Redis, and Celery Beat checks which jobs are due.

## Request flow

1. Django signs in the user and starts a session.
2. The view checks the user's role.
3. A form cleans and validates the submitted values.
4. A service calculates results and saves the related records in one transaction.
5. Follow-ups, duplicate warnings, reports, and change history are updated.
6. The template shows the result or a useful empty/error state.
