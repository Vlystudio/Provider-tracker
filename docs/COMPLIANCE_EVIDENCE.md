# Application evidence

Last reviewed: 2026-08-22

This repository produces technical evidence. It does not certify HIPAA, SOC 2, or another standard.

## Repeatable commands

| Evidence | Command |
| --- | --- |
| Unit/integration suite | `npm test` |
| Hostile-request matrix | `npm run test:security` |
| Database privilege checks | `npm run test:database-security` |
| Governance/audit volume | `npm run test:governance-performance` |
| Automation acceptance | `npm run test:automation` |
| Migration acceptance | `npm run test:migration` |
| Backup/restore | `npm run test:restore` |
| Audit integrity | `npm run db:audit-integrity` |
| Static security | `npm run audit:static-security` |
| Privacy static review | `npm run audit:privacy` |
| Dependency audit | `npm run audit:production` |
| Supply chain | `npm run audit:supply-chain` |
| Secret scan | `npm run scan:secrets` |
| Build/lint/types | `npm run build`, `npm run lint`, `npm run typecheck` |
| Source/build manifest | `npm run release:evidence` |
| Governance manifest | `npm run governance:evidence` |

Commands needing a database must use a disposable/staging database appropriate to the test. Destructive acceptance commands reject a database name that does not end in `_test` unless their explicit production safeguards are satisfied.

## Governance manifest

`npm run governance:evidence` outputs JSON containing:

- evidence format version;
- generated time and environment;
- release/commit/branch;
- safe policy snapshot;
- governance table/configuration counts, if a database is available;
- SHA-256 hashes for required Phase 10 documents;
- the commands needed to regenerate test evidence;
- the statement that the manifest is not a compliance certification.

It does not include database URLs, credentials, user rows, export contents, comments, search values, HMAC values, or sensitive datasets.

## CI evidence package

CI uses a PostGIS test database, runs application and database gates, builds an SBOM, creates release/governance manifests, and uploads them as a time-limited workflow artifact. Container image scan evidence is a separate artifact. Workflow permissions are read-only and checkout credentials are not persisted.

The package should include or link to:

- exact release commit and image digest;
- test logs/results;
- role-to-data matrix;
- data classification and flow;
- audit/incident controls;
- migration and backup/restore evidence;
- dependency, supply-chain, static, privacy, secret, and container scan results;
- access-review capability;
- staging network, identity, monitoring, backup, and UAT evidence when available.

## Freshness rule

Evidence is valid only for the recorded commit, release, environment, tool versions, and generated time. Regenerate it after a code, dependency, schema, deployment, security configuration, identity, network, or backup change. Do not reuse an old result as proof of a new release.

External evidence has its own owner and review date. Examples: VPN route test, TLS scan, IdP/MFA test, database-role output, managed-backup restore, centralized-log search, DLP test, and UAT sign-off.

## Manual decisions that cannot be generated

- workforce access approval and quarterly review decision;
- HIPAA/other regulatory applicability;
- formal risk assessment and risk acceptance;
- retention schedule and legal hold release;
- BAA/vendor approval;
- incident severity and breach-notification decision;
- workforce training and sanctions policy;
- pilot/UAT approval.

The application records authorized access and retention decisions after a human makes them. It never labels them complete automatically.
