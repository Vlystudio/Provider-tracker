# Scheduled Jobs

The sample database includes these jobs:

- create seven-day follow-ups
- find overdue reviews
- flag repeat calls in the same week
- find provider calls older than 30 days
- find facilities with missing coordinates
- save weekly reports
- save monthly reports
- find unresolved import issues
- find facility-specialty mappings that need confirmation

Each job stores its name, purpose, schedule, enabled status, next run, and recent results. A job/date key prevents the same work from being repeated for one schedule period.

In the local demo, **Run now** completes the job immediately. Production uses Redis, Celery workers, and Celery Beat. IT can add notification delivery or scheduled export destinations if needed.
