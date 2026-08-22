# Data governance

Last reviewed: 2026-08-22

## Responsibility boundary

| Area | Application | IT/infrastructure | Organization |
| --- | --- | --- | --- |
| Access | Roles, ownership checks, session revocation, access-review records | Corporate identity, MFA, termination feed, VPN | Role definitions, approvers, review frequency |
| Data classification | Field/table inventory and technical handling | Storage and log inventory | Final classification and data owner |
| Retention | Policy records, holds, dry run, bounded cleanup | Backup expiry, archive storage, restore handling | Retention periods, legal holds, deletion approval |
| Export | Server authorization, scope, limits, CSV safety, audit | DLP/CASB, endpoint controls, network monitoring | Permitted uses and recipients |
| Incident response | Application timeline, revocation, evidence query | Proxy/IdP/database/host logs and containment | Incident command, counsel, notification decisions |
| Compliance | Technical mapping and repeatable evidence | Infrastructure evidence | Applicability, risk assessment, policies, training, BAAs |

Software alone does not establish regulatory compliance.

## Data owners and follow-up

| Owner | Decision/evidence needed | Application dependency | Production blocker |
| --- | --- | --- | --- |
| URA operations owner | Required authorization/provider fields, work reassignment rules, free-text guidance | Field minimization and departure flow | Yes for pilot workflow |
| Privacy/compliance owner | PHI applicability, minimum-necessary policy, retention schedule, low-count reporting rule | Retention and reporting configuration | Yes if real member-linked data is used |
| Security owner | Access-review cadence, investigation authority, incident evidence retention | Governance roles and runbooks | Yes |
| Identity owner | Corporate issuer, claim mapping, MFA, disable/deprovision behavior | OIDC enablement | Yes |
| Infrastructure owner | VPN, TLS, private DNS, origin blocking, database encryption, logs, backups, egress | Production deployment | Yes |
| Vendor management/legal | Hosting, database, monitoring, email, backup, and identity contracts/BAAs where required | Third-party activation | Yes when a vendor receives regulated data |
| Workforce/training owner | Acceptable use, exports, printing, shared devices, incident reporting | User behavior | Yes before real sensitive data |

## Field exposure findings

- Authentication responses do not return password hashes, account tokens, session tokens, HMAC network identifiers, or verification tokens.
- Account-security screens show session dates, not tokens, IP values, or user-agent strings.
- Governance screens show staff name/email, role, status, sign-in date, review state, and action counts. They omit authentication identifiers and audit HMAC values.
- Auditor access is read-only. Auditors cannot mutate provider truth, change users, certify access, configure retention, place holds, or export provider rows.
- Report viewers receive aggregate reports and limited drilldowns. They do not receive authorization records, provider-search row access, migration data, staff administration, audit data, governance data, or provider-row export.
- Provider export omits comments, notes, diagnosis values, exact coordinates, source metadata, version numbers, assignment data, staff identity, and audit fields.
- Audit pages expose actor identity, action, target type/ID, result, and time. They do not expose request bodies, cookies, tokens, source HMAC values, comments, or full exported rows.

## Administrator boundary

The current `admin` role combines system administration and operational-data administration. That matches the existing small-team operating model, but it is broader than an identity-only administrator. The application does separate `admin:manage-users`, `admin:manage-data`, `governance:manage`, export, migration, automation, and investigation permissions internally. A future corporate role model can split those permissions without changing each route.

Until that split is approved, administrator assignment is a privileged decision, appears in access review, and is removed by emergency revocation. IT should not map a general help-desk group directly to `admin`.

## Search, counts, and URLs

Provider search is limited to operational roles and active, non-merged facilities. Report viewers cannot infer provider/authorization rows through the provider-search page or API permissions. Authorization rows are creator-scoped for URA users and admin-scoped for administrators.

Aggregate specialty/coverage counts can reveal low provider availability, but they do not identify a member. No arbitrary small-count suppression was added. The privacy/compliance owner must decide whether production data or business context makes suppression necessary.

Provider-search filters currently use URL query parameters so pages can be bookmarked and paginated. Those parameters can include ZIP, diagnosis, and specialty. The application does not include a member name or authorization number in the search URL, sends only the origin in cross-origin referrers, and does not log the query string. If operations later ties those filters to a named member in the same browser workflow, move sensitive search state to a POST-backed server record before production use.

Incident investigation and export filters use POST bodies, not URLs.

## Browser, print, clipboard, and shared devices

- No sensitive server record is deliberately persisted in browser storage.
- Authenticated responses use `private, no-store`.
- Logout and account disablement revoke server access; back-button content cannot issue an authorized request.
- The application has no bulk clipboard feature.
- Browser printing is an export. Print CSS does not add hidden admin or authentication fields, but workstation print controls remain organizational.
- Export confirmations and governance forms use native keyboard-accessible controls and visible text. No hover-only privacy control is used.

## Metrics and error tracking

Metrics allow only `route`, `method`, `status`, `operation`, and `result` labels. Route values are fixed groups. Email, user IDs, provider names, diagnosis, comments, and report-filter values are not metrics.

The built-in error reporter writes structured, redacted logs. Any future external error-tracking adapter must pass the same redaction tests for request bodies, headers, cookies, route parameters, and user input before enablement. Do not send full requests by default.

## Data at rest

Infrastructure encryption at rest and database TLS are required but not proved by this repository. Application-level encryption is not added to query-heavy provider or authorization fields without an approved threat model and key-management design.

Password values are one-way hashed. Session/verification tokens and future identity-provider tokens are credentials and need strict database/secret-store access. Better Auth does not encrypt provider tokens by default. Corporate OIDC must not be enabled until token storage, rotation, and vendor controls are approved.

## Cryptographic inventory

| Mechanism | Algorithm/control | Purpose | Key source | Rotation note |
| --- | --- | --- | --- | --- |
| Password hash | Better Auth default `scrypt` | Password verification | Per-hash parameters managed by library | Rehash strategy required if algorithm changes |
| Audit/network correlation | HMAC-SHA-256 | Correlate email/IP values without storing raw value | `AUDIT_LOG_IP_SALT` from secret manager | Rotation breaks correlation across the boundary; record rotation time, not key |
| Session and auth signing/encryption | Better Auth managed | Session/authentication integrity | `BETTER_AUTH_SECRET` from secret manager | Use approved versioned-secret procedure and test active sessions |
| Workbook/source hashes | SHA-256 | Source identity and reconciliation | No secret key | Algorithm/version stored in migration evidence where applicable |
| Backup/artifact checksums | SHA-256 | Detect artifact corruption | No secret key | Recompute for every evidence package |
| TLS | Platform-approved TLS | Data in transit | Ingress/database certificate and key stores | IT-owned certificate rotation and validation |

Algorithms are called through Node.js or the authentication library; there is no custom cryptographic framework. Better Auth documents its default password hashing and secret handling in its [security reference](https://better-auth.com/docs/reference/security). Node documents the HMAC primitive in the [Node.js crypto API](https://nodejs.org/api/crypto.html).

## Third-party and BAA inventory

No BAA is asserted.

| Service | Current state | Data it could receive | Required review before production |
| --- | --- | --- | --- |
| Hosting/container platform | Not selected | Application traffic, logs, secrets in runtime, possibly PHI | Security, privacy, contract/BAA where applicable |
| PostgreSQL/PostGIS service | Not selected | Entire database | Encryption, access, backup, region, retention, contract/BAA |
| Corporate identity provider | Not connected | Name, email, group/role claims, auth identifiers, IP/log data | Claim minimization, MFA, lifecycle, token handling, contract review |
| Monitoring/log platform | Not connected | Redacted operational telemetry, request IDs, IP HMAC | Redaction verification, access/retention, contract review |
| Error tracking | Not connected | Redacted exception and route data | SDK redaction tests and outbound-data review |
| Email provider | Not connected | Recipient email and generic notification text | Keep PHI out of email; contract/BAA if scope changes |
| Backup provider | Not selected | Full encrypted database backup | Encryption, key control, expiry, restore access, contract/BAA |
| DLP/CASB | Not connected | Export metadata/content at endpoint or network layer | Integration and policy owner |

## Change attribution and historical correction

Material changes are attributed to an authenticated user, a legacy actor/import batch, or a system job execution. Verification events, contact attempts, migration runs, merge records, operational changes, and audit events preserve history. Incorrect historical records should be corrected through a new event, explicit resolution, undo record, or superseding state where the workflow supports it. Do not rewrite audit history.
