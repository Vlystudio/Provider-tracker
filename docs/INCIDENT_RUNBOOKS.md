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
| Application or origin publicly reachable | outside-VPN proof, DNS, firewall/load-balancer change, origin flow logs | remove public route immediately; block origin; preserve configuration and access logs; do not rely on application login as containment | incident lead, network, security |
| Stolen user account/session | authentication, session, IP/request, data-access, export and ownership events | disable account; revoke all sessions; reset through approved identity check; preserve browser/IdP/ingress evidence | security help desk and application owner |
| Stolen administrator account/session | all user, role, password, session, migration, merge, automation and audit actions | disable account; revoke sessions; block source where justified; rotate affected credentials; pause privileged workflows | incident lead, security, application owner |
| Runtime database credential leaked | DB sessions, source network, SQL/audit history, secret access logs | revoke/rotate runtime role; terminate sessions; isolate app workloads; verify schema/role/server-file boundaries; do not grant a replacement broader rights | DBA, security, platform |
| Suspected application-process compromise | workload process/network/file activity, image digest, environment access, DB and audit events | isolate workload; block egress; revoke runtime/auth/metrics secrets; preserve memory/log/platform evidence; replace from reviewed signed image | incident lead, security, platform |
| Malicious dependency or build | source commit, lockfile, CI logs, action digests, SBOM, image digest/signature, registry pulls | stop pipeline/deployments; revoke CI credentials; quarantine artifacts/images; identify first affected release; create a new artifact from the reviewed commit in a clean runner | security and release owner |
| Malicious workbook | file hash/source, parser result, migration run, diagnostics, database writes | quarantine original in approved evidence storage; stop/apply no migration; reverse only through documented safe path; preserve parser and audit evidence | security, migration owner, DBA |
| Suspected exfiltration | egress/firewall/DNS, DB query, report/export, account/session, workload and SIEM events | block suspect account/workload/egress; rotate credentials; preserve logs; determine fields, records, recipients and time window; start notification process under policy | incident lead, privacy/legal, security |
| Audit tampering or logging gap | `db:audit-integrity`, DB grants, collector lag, clock, workload/DB admin actions | isolate affected identity; preserve database/WAL/SIEM copies; restore collection; never edit rows to hide the gap | security, DBA, logging owner |

## Account operations

- Disable or re-enable an account through the administrator interface/API; the change revokes sessions and writes an audit event.
- Reset a password only after the organization's identity check. Deliver it through an approved secure channel. Reset revokes existing sessions.
- Revoke sessions immediately with a password/role/activation change, or use the parameterized emergency transaction in `OPERATIONS.md`.
- Bootstrap an administrator only when no active administrator exists. If all administrators are lost, a DBA and security approver run the documented bootstrap command from a trusted host. There is no universal recovery password.

## Audit investigation

Auditors and administrators can view audit events according to the existing role policy. Trace a request with `X-Request-ID`, then compare the structured application event and `audit_events.request_id`. For a suspicious role change, identify actor, target, before/after values, correlated request, nearby authentication events, and session revocation. Export only the minimum necessary fields to approved encrypted storage. Never edit audit rows during cleanup; `npm run db:audit-integrity` is read-only.

The Data Governance page can produce a bounded account activity report without returning tokens, raw network addresses, request bodies, or record contents. Use it to establish an initial timeline, then correlate the result with ingress, VPN, identity-provider, database, platform, and SIEM records. Its omissions are intentional and mean it is not a complete forensic record.

Audit retention is an organization decision. Until approved, retain audit, verification, contact, import, duplicate, and merge history. Detached historical targets are reported separately because account removal can null a foreign-key actor while the audit event remains.

## Containment order for a suspected breach

1. Assign an incident lead and record the first known time, reporter, affected environment and current release/image digest.
2. Preserve ingress, VPN, IdP, application, audit, database, platform, CI and secret-store evidence before routine restart or cleanup.
3. Remove public routes or isolate the affected account/workload. Do not make the application public merely to aid troubleshooting.
4. Revoke the narrowest affected sessions and credentials. If scope is uncertain, revoke the runtime DB secret and all application sessions, then force reauthentication.
5. Block unexpected egress and suspend migration, backup, scheduler and deployment identities until their integrity is known.
6. Determine data and actions reachable under the compromised identity using the blast-radius table in `SECURITY_THREAT_MODEL.md`.
7. Recover with a reviewed image and known schema/backup state. Run security, database privilege, smoke and audit-integrity checks before restoring traffic.
8. Record timeline, affected data/accounts, root cause, containment, credential rotations, evidence locations and follow-up owners.

## Public exposure response

An HTTP `401`, `403`, `404`, redirect, health response or sign-in page observed from outside VPN is still public exposure. Network removes the route and locks down the origin first. Application and security owners then review ingress logs from the earliest possible exposure time, authentication attempts, sessions, administrative actions and data access. Run the outside-VPN probe again from two networks only after configuration is corrected.

## Pilot stop rules

Stop the pilot immediately for suspected public/origin/database exposure, authentication bypass, privilege escalation, data exfiltration, code execution, data corruption, or loss of the required audit trail. Treat those events as P0. Contain access, preserve VPN/identity/ingress/application/database/platform evidence, invoke the incident owner, and require a new security GO decision before resuming.

A blocked primary workflow without a safe workaround is P1. A major issue with a documented workaround is P2. A minor issue or preference is P3. Severity does not replace the separate rollback rules in `PRODUCTION_CUTOVER.md`.

## Credential rotation notes

Test rotations in staging first. Runtime database, metrics, IdP and backup credentials can be independently replaced through the secret store. A Better Auth secret change may invalidate every session; schedule and communicate a forced login if the deployed version cannot overlap secrets. Changing the audit HMAC salt changes future pseudonymous identifiers, so use a recorded versioned cutover and preserve the old salt only under approved forensic custody. Never rewrite old audit events.

## Privacy and breach process

Use `BREACH_RESPONSE.md` for the application-specific evidence and containment checklist. Place retention holds before approved cleanup jobs run, but also preserve external logs and backups under the organization's evidence process. Application holds do not control backup expiration, SIEM retention, or records held by a vendor.

Privacy, legal, and security owners determine whether an event is a reportable breach and which notification deadlines apply. The application only supplies evidence and containment controls; operators must not treat its incident report as that determination.
