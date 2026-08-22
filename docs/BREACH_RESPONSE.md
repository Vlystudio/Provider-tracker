# Breach and account investigation

Last reviewed: 2026-08-22

This is a technical runbook. Incident command, legal conclusions, breach notification, law-enforcement contact, and communications follow authorized organizational procedures.

## Immediate containment

1. Record the reporter, affected account/system, first known time, and current release ID in the incident system.
2. Preserve application, audit, proxy, identity-provider, database, scheduler, deployment, export, and infrastructure logs.
3. Place retention/log/backup holds in each system that supports them.
4. Use emergency revocation for suspected accounts. Do not revoke the last active administrator without a recovery path.
5. Rotate affected application/database/identity credentials through the approved secret manager. Record only that rotation occurred.
6. Restrict ingress, egress, or the application if continuing access could increase harm.
7. Record the investigation window and generate an account investigation report.
8. Review exports, mutations, denied actions, admin changes, migration actions, work/notification changes, and current sessions.
9. Correlate application evidence with IdP, proxy, database, host/container, DLP, and backup evidence.
10. Follow the organization’s incident-response and privacy/legal decision process.

Do not invent or apply a legal notification timeline from this runbook. HHS describes the federal HIPAA Breach Notification Rule and its risk factors on the [HHS Breach Notification Rule page](https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html). Applicability and notification decisions belong to authorized privacy/legal staff.

## Emergency account action

From Data Governance, select the account and use **Emergency revoke**. This disables the account, removes privilege, deletes current sessions, counts work needing reassignment, and writes an audit event. Confirm the old session receives 401 before considering the application session contained.

When corporate identity is connected, also disable the user upstream and confirm the Provider Tracker sign-in path rejects the upstream account.

## Investigation report

Use the Account investigation form under Data Governance. The request is a POST body containing account, start, and end time. Windows are limited to 366 days and event output is bounded by `GOVERNANCE_INCIDENT_MAX_EVENTS`.

The report summarizes:

- successful and failed sign-ins;
- authorization failures;
- provider searches;
- report views;
- exports;
- privileged/security actions;
- successful mutations;
- current session time ranges;
- event action, result, target type/ID, and time.

It deliberately omits passwords, tokens, cookies, raw/HMAC network values, request bodies, comments, search values, and export content. A security investigator can use database/proxy/IdP access for approved network correlation.

## Read-evidence coverage

| Activity | Application evidence | Limitation |
| --- | --- | --- |
| Sign-in/sign-out | Action, result, actor when known, status, email HMAC, IP HMAC, request ID | IdP/MFA detail requires IdP logs |
| Authorization failure | Actor, permission target, time, result | Does not identify every underlying row the user tried to infer |
| Provider search | Actor, row/total count, page, filter names | No filter values or returned-row list |
| Report view | Actor, count and filter names | No rendered-row list |
| Export | Actor, type, record/total count, filter names, target | Does not store file contents |
| Audit search | Actor, filter names, result count | Normal unfiltered audit navigation is not logged |
| Admin/governance change | Actor, target, old/new safe values, result | External identity/group change is outside the app |
| Operational mutation | Actor, target, changed-field names or event ID | Full comments/request body excluded |
| Normal facility/detail read | Session authorization only | Not individually reconstructed |
| Database read | Database role/query logs if enabled | Not logged per row by the application |

Do not describe the report as a complete breach scope. It is an application-evidence summary.

## Synthetic compromised-account drill

1. Create a synthetic URA account in a test environment.
2. Sign in and record a provider search, allowed mutation, and allowed provider export where PostGIS is available.
3. Attempt user administration, governance decision, retention change, and migration export; expect 403.
4. Run emergency revocation; expect old session reuse to return 401.
5. Generate the account investigation report.
6. Verify sign-in, search, mutation, denied action, export, and revocation evidence is shown where that action ran.
7. Verify the report states gaps instead of inventing read rows.

## Synthetic administrator-compromise drill

1. Create a separate synthetic administrator; never use a real production account.
2. Change a synthetic user role, record an access decision, run an approved test export/admin action, and place/release a test hold.
3. Revoke the administrator from a second administrator account.
4. Confirm session invalidation, role removal, account disablement, audit events, and security timeline.
5. Preserve the generated evidence and remove synthetic data under the test-environment cleanup procedure.

## Evidence preservation

Preserve at least:

- `audit_events`, access decisions, retention policies/holds, and current session dates;
- application structured logs and release/build ID;
- proxy/WAF/VPN/DNS logs;
- IdP sign-in, MFA, group, disable, and token logs;
- PostgreSQL connection/query/audit logs where enabled;
- scheduler/job execution logs;
- export/DLP events;
- deployment/image/SBOM/vulnerability evidence;
- backup catalog, restore logs, and relevant immutable copies.

Document collection time, source, hash where practical, handler, transfer, and storage location. NIST’s current incident-response guidance includes evidence preservation as an organizational capability; see [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final).

## Evidence holds and housekeeping

Application holds prevent the implemented cleanup process from deleting held session/token/rate-limit rows. Business and audit records currently have no cleanup command. Place separate holds in centralized logging, IdP, proxy, database, container, and backup platforms. A Provider Tracker hold does not control those systems.
