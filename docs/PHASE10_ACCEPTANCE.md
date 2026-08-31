# Phase 10 acceptance

Last reviewed: 2026-08-22

## Status

**PHASE 10 GOVERNANCE ACCEPTANCE PASSED — ORGANIZATIONAL/INFRASTRUCTURE VALIDATION PENDING**

The repository controls passed. This is not a regulatory certification. Production use with real organizational or health data remains blocked until the named policy and infrastructure owners complete their work.

## Data classification

- Reviewed all 42 application tables plus browser, request, log, metric, export, backup, identity, and vendor flows.
- Potential PHI includes member ZIP, diagnosis, specialty, facility selection, and operational notes when tied to a person. The former payer-issued identifier has been removed and replaced by a random Tracking ID.
- PII includes staff name, email, session activity, account status, role history, and audit attribution.
- Free text exists in verification/contact comments, migration notes/reasons, operational work, notification content, and hold policy references. These fields must not be used for credentials or unnecessary patient detail.
- Raw client addresses and browser user-agent strings were identified as unnecessary persistent session data. New sessions store an HMAC-derived address and no user agent. Audit/search/export metadata keeps filter names and counts, not values or returned content.
- Better Auth account token columns are currently unused for local password login. If corporate identity uses them, IT must decide whether to encrypt tokens at the application layer and how keys rotate.

The complete inventory and handling rules are in [DATA_CLASSIFICATION.md](DATA_CLASSIFICATION.md), [DATA_FLOW_SECURITY.md](DATA_FLOW_SECURITY.md), and [DATA_GOVERNANCE.md](DATA_GOVERNANCE.md).

## Access governance

The role/data matrix is in [ACCESS_GOVERNANCE.md](ACCESS_GOVERNANCE.md). URA users can work operational records and export the provider directory. Report viewers receive aggregate reports, not provider-row exports. Auditors can review audit/governance records and run bounded investigations but cannot certify access, change retention, export provider rows, or administer users. Administrators hold the combined management role; that concentration of privilege remains an organizational risk to review.

The access workspace flags active accounts after the configured inactivity period, identifies administrators, shows last sign-in and role-assignment time, and records retain/modify/disable/investigate decisions by quarter. A decision does not silently change an account. Emergency revocation requires recent authentication, blocks self-revocation and removal of the last administrator, disables the target, removes privilege, revokes sessions, counts assigned work, and writes an audit event.

The final synthetic database had 5 fixture accounts, 3 active, 1 active administrator, 0 dormant at the 90-day threshold, and 1 recorded review decision. Those counts are test evidence, not a production access review. Corporate account inventory, managers, employment status, service accounts, and quarterly approval remain external.

## Retention

Configured categories are expired sessions, expired verification/reset tokens, and inactive rate-limit buckets. Audit, provider verification/contact/merge history, imports, migrations, and access-review decisions are retained by design because no approved destructive policy exists.

Destructive housekeeping is off by default. Enabling a category requires a day count, controlled policy reference, recent administrator authentication, and the exact confirmation `ENABLE RETENTION`. The job additionally requires target environment, database, approval, and actor confirmation, then deletes at most the configured batch. Holds can cover a category or one record; place and release actions require reason codes and are audited.

The final dry run used a 1,000-row batch limit. Expired sessions had a configured 30-day test period with 0 eligible, 0 held, and 0 deleted rows. The other two categories were not configured. No destructive run was performed. Backup expiry and evidence holds are separate infrastructure policies; see [RETENTION.md](RETENTION.md).

## Export security

There are two CSV surfaces: provider-directory results and migration diagnostics. Both use explicit permissions, server-side scope, same-origin POST or authenticated access, bounded output, generic dated filenames, `no-store`, `nosniff`, restrictive content policy, spreadsheet-formula neutralization, and audit events that omit exported content and filter values.

Provider rows are limited to administrators and URA users and capped by `EXPORT_MAX_ROWS` (default 1,000). Anonymous access returned 401; report viewers and auditors returned 403; the allowed URA test returned 200 with confidential/no-store download headers. Invalid filters returned 400. Unit tests covered cells beginning with `=`, `+`, `-`, and `@`. Details are in [EXPORT_SECURITY.md](EXPORT_SECURITY.md).

## Privacy

- Notifications remain in-app, recipient-owned, and limited to operational summaries. IDOR checks passed.
- Digest generation reevaluates recipient access and is deduplicated. No email or external notification vendor is configured.
- Metric labels remain allowlisted and exclude user input, account identity, record IDs, and query values.
- Structured logging redacts credentials, tokens, raw addresses, email-like values, member/diagnosis fields, urgent-referral requirements, and other sensitive keys.
- Authenticated responses use no-store defaults. The client uses no local/session storage or IndexedDB for application data. Export blob URLs are revoked immediately after the browser starts the download.
- Sensitive filters are accepted in server request bodies where possible. Existing report/search GET filters can appear in browser history, so real patient/member identifiers must not be placed in those fields.
- Print, copy, endpoint DLP, managed browser, shared-device, and approved export-location policy remain IT responsibilities.

The privacy static review examined 183 source files and found no persistent browser storage, client/server boundary, logging, metric-label, authenticated-cache, source-map, or download-header finding.

## Incident readiness

The application provides a searchable audit log and a bounded account report covering sign-ins, denials, searches, reports, exports, mutations, privileged actions, and current session ranges. Report output omits tokens, cookies, raw/HMAC network values, request bodies, comments, search values, and export contents. The 105-scenario drill verified emergency revocation, old-session rejection, incident reporting, export boundaries, and 24 required audit action types.

Audit integrity passed with zero missing actors for required successful events, invalid timestamps, unknown actions, or broken live actor references. One intentionally deleted synthetic account left one detached session actor and one historical user target; both remain reported instead of rewriting history.

Normal facility/detail reads and row-level database reads cannot be perfectly reconstructed. Investigators must correlate application evidence with VPN, proxy, IdP, PostgreSQL, platform, DLP, backup, and SIEM records. Use [BREACH_RESPONSE.md](BREACH_RESPONSE.md) and [INCIDENT_RUNBOOKS.md](INCIDENT_RUNBOOKS.md).

## Healthcare and compliance readiness

Provider Tracker is PHI-capable because authorization, location, diagnosis, and free-text data can become identifying when combined. Whether a deployment is subject to HIPAA, which uses are permitted, and which fields are minimum necessary are legal/privacy decisions outside the application.

[HIPAA_TECHNICAL_READINESS.md](HIPAA_TECHNICAL_READINESS.md) maps application controls and gaps without claiming compliance. [DATA_FLOW_SECURITY.md](DATA_FLOW_SECURITY.md) inventories hosting, PostgreSQL, identity, logging, backup, CI/registry, and endpoint dependencies. Vendor approval, BAAs or other contract terms, risk analysis, workforce training/sanctions, physical safeguards, retention schedules, and breach-notification decisions remain organizational work.

## Testing

| Gate | Result |
| --- | --- |
| Unit/integration | PASS — 33 files, 144 tests |
| Governance-specific unit validation | PASS — 8 cases within the 144-test suite |
| Hostile requests and account-compromise drill | PASS — 105/105 scenarios; 24/24 required audit action types |
| Database privilege | PASS — 12/12; audit UPDATE/DELETE denied |
| Automation | PASS — 16/16 scenarios |
| Migration | PASS — 11/11 scenarios |
| Retention dry run | PASS — 3 categories reviewed; 0 records deleted |
| Audit integrity | PASS — 4/4 failure checks at zero |
| ESLint | PASS |
| TypeScript | PASS |
| Production build | PASS — 45 routes/pages generated |
| Production dependency audit | PASS — 0 vulnerabilities |
| Supply chain | PASS — 760 locked packages; 5 install scripts reviewed |
| Static security | PASS — 149 runtime files; 44 API route files |
| Privacy static review | PASS — 183 files; 0 findings |
| Secret scan | PASS — 333 repository files and 39 commits at time of run |
| Backup/restore | NOT RUN LOCALLY — `pg_dump.exe` is unavailable. The acceptance script now requires and compares access-review, retention-policy, and hold tables; CI is configured to execute it with PostgreSQL tooling. |

The dependency, supply-chain, static, privacy, and secret gates were rerun on the final source. The restore result is an infrastructure/tooling exception, not a passing restore claim.

## Performance

The governance benchmark inserted 100,000 synthetic audit events in a transaction, queried a bounded 500-event incident window, and checked deep audit pagination. Insert time was 1,279.3 ms, incident query 18.6 ms, and deep-page query 24.3 ms on the local test database. Access-review recovery returned 1 row. The transaction was rolled back.

This is representative local evidence, not a production capacity guarantee. Repeat it in staging with production-like PostgreSQL, indexes, concurrent load, retention volume, and monitoring.

## Repository

- Starting HEAD: `bfdd93e78d59829f11b14b4c686991e7ab82c211`
- Implementation/test HEAD: `d9005bb4884784a7ab2675cb7b54e34a2ebf552c`
- Documentation acceptance HEAD: the commit containing this file; resolve with `git log -1 --format=%H -- docs/PHASE10_ACCEPTANCE.md`
- Branch: `master`
- Commits: `3f19346 Add data governance controls`; `d9005bb Expand privacy and security acceptance`; final governance documentation commit
- Working tree target: clean after the documentation commit
- Remote: none configured
- Push status: not pushed; Phase 10 did not authorize a push

## External blockers

Phase 9 blockers remain: VPN/private DNS, direct-origin blocking, corporate identity and MFA, TLS, PostgreSQL/PostGIS staging, container runtime and image-scan evidence, monitoring and centralized logging, managed backup/restore, egress restrictions, and real UAT.

Authorized organizational owners must also decide regulatory applicability, minimum-necessary roles/fields, access-review cadence, termination timing, service-account review, retention and backup schedules, hold/release authority, export approval and DLP destinations, vendor/BAA requirements, formal risk treatment, workforce training, and breach-notification procedures.
