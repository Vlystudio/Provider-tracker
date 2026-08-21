# Pilot rollout

## Cohort

Start with a small named group: a few URA users, at least one report viewer, an auditor/security representative, and the minimum number of administrators. Identity and business owners supply the actual names. No one receives administrator access for convenience.

For every pilot account record the corporate identity, Provider Tracker user ID, role, approver, provisioning date, MFA requirement, and planned removal/review date. Test each account independently.

## Role acceptance

| Role | Must pass | Must remain blocked |
| --- | --- | --- |
| URA | VPN, sign-in/MFA, provider search, facility workflow, assigned work | Admin, migration, user management, audit-only functions |
| Report viewer | Approved reports and drilldowns | Provider mutation, admin, migration |
| Auditor | Audit and approved review pages | Operational mutation, admin changes, migration apply |
| Admin | Approved user/session, data-quality, automation, and migration work | Anything outside the documented administrator permissions |

Use `UAT.md` for the detailed script. Record tester, role, release, database migration, source hashes, run ID, date, result, defect, retest, and sign-off. A checklist prepared by engineering is not business approval.

## Primary workflow

The URA pilot must complete the real sequence: connect to VPN, authenticate, find a provider, read verification freshness, record contact, update verified information, finish the work item, and confirm the audit history. Reporting users must explain the period, numerator, denominator, filters, and drilldown. Administrators must prove user/role changes, session revocation, and automation health.

## Guardrails

- keep the cohort small;
- retain the prior image and rollback path;
- keep the legacy workbook read-only;
- avoid unrelated schema or feature changes;
- monitor errors, latency, security events, jobs, backups, and feedback daily;
- stop on suspected public exposure, authentication bypass, privilege escalation, data exfiltration, code execution, or database exposure.

## Finding record

Record each finding with: ID, time, reporter, release, role, category, severity, workflow, expected result, actual result, request ID, safe evidence location, owner, target date, retest, and decision.

Categories are defect, usability, data, migration, performance, training, and enhancement.

| Severity | Project rule | Response |
| --- | --- | --- |
| P0 | Breach, public/database exposure, data corruption, or application unavailable for the pilot | Stop pilot, contain, preserve evidence, start incident process |
| P1 | Primary workflow or identity path blocked with no safe workaround | Hold affected use and assign immediate fix/rollback decision |
| P2 | Major issue with a safe documented workaround | Track, prioritize, and retest before expansion if it affects many users |
| P3 | Minor issue or preference | Record for later review; does not block by itself |

## Baselines

At pilot start record facility totals, stale/never-verified counts, duplicate candidates, missing coordinates, incomplete contact data, known-good report numerators/denominators, notification/work volumes, job duration, database pool use, and p50/p95 for sign-in, dashboard, search, 50-mile search, reports, and work inbox.

## Success criteria

- zero open Critical or High security findings;
- zero unexplained data-loss or reconciliation events;
- no unresolved incorrect-report defect;
- stable VPN, identity, MFA, and authorization;
- usable provider search and primary URA workflow;
- automation runs once without a notification flood;
- central monitoring and alerts are active;
- managed backups succeed and restore has been proved;
- pilot users complete their primary workflows;
- rollback remains ready.

## Expansion decision

At the review choose one: `EXPAND`, `HOLD`, or `ROLLBACK`. Include the evidence and named approvers. Uptime alone is not approval to expand.
