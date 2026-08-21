# Incident runbooks

Start every incident by recording time, release (`X-App-Release`), affected environment, request IDs, impact, and incident owner. Preserve logs and audit records. Do not paste secrets or user-entered notes into tickets.

| Incident | Checks | Safe actions | Escalate to |
| --- | --- | --- | --- |
| Application unavailable | load balancer, `/api/health`, container status, startup logs | remove failed instance; restart only after collecting logs; roll back compatible image | application owner, then hosting owner |
| Database unavailable | `/api/ready`, pool metrics, PostgreSQL status/network, connection limit | stop routing; restore database service; do not increase pool blindly | DBA/managed database owner |
| Authentication failing | sign-in status, database health, public origin, cookie attributes, recent secret change | restore last known configuration; revoke affected sessions if needed; never bypass auth | application/security owner |
| Geographic search failing | readiness spatial checks, `npm run test:postgis`, query plan/index | stop release; restore missing extension/index through approved migration | DBA and application owner |
| Reports failing | request ID, report timing/failure metrics, database plan and date range | remove bad release or correct database issue; do not return partial invented totals | application owner |
| High error rate | route group, release, correlated logs, dependency state | drain bad instance; roll back application if schema compatible | incident lead |
| Slow application | p95 by operation, pool waiting, PostgreSQL locks/slow queries, CPU/memory | reduce traffic, resolve lock, analyze data, or roll back; avoid cache/schema changes during incident | application and infrastructure owners |
| User locked out | account active state, role, sessions, failed-login/rate-limit pattern | administrator verifies identity, re-enables or resets password through approved flow | administrator/security help desk |
| Backup failed | job exit, destination capacity/permissions, tool version | retain prior backups; correct destination/tool issue; rerun and verify checksum | backup owner/DBA |
| Restore required | incident recovery point, valid backup/PITR, replacement capacity | follow `BACKUP_RESTORE.md`; restore to isolated target and validate before traffic | incident lead, DBA, security |

## Account operations

- Disable or re-enable an account through the administrator interface/API; the change revokes sessions and writes an audit event.
- Reset a password only after the organization's identity check. Deliver it through an approved secure channel. Reset revokes existing sessions.
- Revoke sessions immediately with a password/role/activation change, or use the parameterized emergency transaction in `OPERATIONS.md`.
- Bootstrap an administrator only when no active administrator exists. If all administrators are lost, a DBA and security approver run the documented bootstrap command from a trusted host. There is no universal recovery password.

## Audit investigation

Auditors and administrators can view audit events according to the existing role policy. Trace a request with `X-Request-ID`, then compare the structured application event and `audit_events.request_id`. For a suspicious role change, identify actor, target, before/after values, correlated request, nearby authentication events, and session revocation. Export only the minimum necessary fields to approved encrypted storage. Never edit audit rows during cleanup; `npm run db:audit-integrity` is read-only.

Audit retention is an organization decision. Until approved, retain audit, verification, contact, import, duplicate, and merge history. Detached historical targets are reported separately because account removal can null a foreign-key actor while the audit event remains.
