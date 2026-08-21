# Staging certification

Staging certification is an evidence review, not a statement that the repository looks ready. Use a production-like private environment and keep the tested image unchanged for production promotion.

## Current readiness inventory

Inventory date: 2026-08-21. No staging hostname, VPN test position, identity provider, PostgreSQL/PostGIS target, secret store, log collector, scheduler, backup service, pilot roster, or business tester was available from this workstation.

| Dependency | Owner | Available | Configured | Testable | Passed | Deployment blocker |
| --- | --- | --- | --- | --- | --- | --- |
| VPN, private DNS, private ingress, origin firewall | Network | No | No | No | No | Yes |
| TLS and proxy header replacement | Ingress/Security | No | No | No | No | Yes |
| Approved identity strategy and MFA | Identity/Security | No | No | No | No | Yes |
| Managed runtime secrets and rotation | Platform/Security | No | No | No | No | Yes |
| PostgreSQL 16/PostGIS and private database path | DBA/Network | No | No | No | No | Yes |
| Production container runtime and registry | Platform/Release | Docker CLI only | Repository template only | No; local engine stopped | No | Yes |
| Central logs, metrics, and alert delivery | Operations/Security | No | Application output only | No | No | Yes |
| External scheduler | Operations | No | Commands exist | No | No | Yes |
| Managed backup and isolated spatial restore | Backup/DBA | No | Procedures exist | No | No | Yes |
| Realistic migration source and reconciliation owner | Migration/Business | No | Pipeline exists | No | No | Yes |
| Pilot accounts and business UAT | Business/Identity | No | Checklists exist | No | No | Yes |
| Local engineering verification | Application | Yes | Yes | Yes | Phase 8 baseline passed; Phase 9 rerun required | Yes until rerun |

This matrix changes only when an owner attaches dated evidence. A repository setting cannot change an infrastructure row to passed.

## Evidence record

Create the blank non-secret evidence record outside Git:

```powershell
New-Item -ItemType Directory -Force work | Out-Null
npm run phase9:status -- --template > work/phase9-evidence.json
```

For each gate record availability, configuration, testability, result, evidence reference, test time, and approver. Evidence references should point to the approved ticket, scan, log search, flow log, screenshot, or run record. Do not copy secrets into the file.

Evaluate it with:

```powershell
npm run phase9:status -- --file work/phase9-evidence.json
```

The command fails unless every blocking gate has dated evidence and approval. A failed blocking test reports a technical failure. Missing tests report infrastructure validation required.

## Certification order

1. Select the clean source commit and immutable image digest. Keep the same image through staging and production.
2. Load the production-style configuration from the approved secret and configuration systems.
3. Compare staging and production profiles with `npm run audit:configuration-drift -- --staging <file> --production <file>`. Review environment-specific differences. The command never prints or compares secret values.
4. Run the outside-VPN tests from two approved networks. Run the on-VPN tests from an ordinary user network.
5. Validate identity, MFA, account linking, disabled-user behavior, role control, and revocation.
6. Apply migrations with the migration identity. Run PostGIS, least-privilege, geographic correctness, and performance gates.
7. Build and scan the final image. Inspect runtime user, filesystem, capabilities, limits, mounts, listeners, and egress.
8. Connect central logs, metrics, alerts, scheduler, and managed backups. Complete an isolated PostGIS restore.
9. Rehearse the final workbook migration and reconcile every source row and report total.
10. Run authenticated smoke, security, load, concurrency, UAT, and rollback tests.
11. Complete the evidence record and hold the named GO/NO-GO review.

## Required measurements

Retain p50, p95, error rate, and test size for sign-in, dashboard, normal provider search, 50-mile search, reports, and work inbox. Retain query plans and index use for every geographic benchmark. Retain actual backup age, restore duration, measured recovery point, and measured recovery time.

## Certification rule

Production pilot approval requires every blocking Phase 9 gate to pass against actual infrastructure. The present status is:

`PRODUCTION PILOT BLOCKED — INFRASTRUCTURE VALIDATION REQUIRED`
