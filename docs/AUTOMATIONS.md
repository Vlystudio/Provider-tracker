# Automations

The demonstration configures these visible rules:

- seven-day follow-up creation;
- overdue review notification evaluation;
- weekly duplicate monitoring;
- stale availability monitoring;
- missing coordinate review;
- weekly report snapshots;
- monthly report snapshots;
- unresolved import issue monitoring; and
- facility reconfirmation.

Each rule records enabled state, purpose, schedule/trigger, next run, recent run history, affected count, outcome, details, and errors. A rule/date idempotency key prevents repeated effects in the same schedule window.

Local demo mode executes tasks eagerly and exposes a safe **Run now** action. Production-style mode uses Redis, Celery workers, and Celery Beat. Notification delivery and scheduled export destinations remain deployment integrations; the rules already surface their affected records and audit evidence.
