# Data flow and trust boundaries

Last reviewed: 2026-08-22

## Main flow

`Managed browser → corporate VPN/private DNS → TLS ingress → Provider Tracker → restricted PostgreSQL/PostGIS`

Supporting flows:

- Corporate identity provider → ingress/authentication service → user and session records. This is designed but not enabled.
- Legacy workbook → migration preview → staged rows/diagnostics → administrator approval → operational tables.
- Scheduler → bounded automation job → work items, notifications, digests, and audit events.
- Authorized browser → POST export request → streamed CSV response → approved endpoint controls/DLP.
- PostgreSQL → encrypted managed backup → restricted backup store → tested restore environment.
- Application/ingress/database → centralized logs and monitoring. These external destinations are not configured in this repository.

## Boundary table

| Boundary | Data crossing | Authentication/authorization | Encryption | Storage |
| --- | --- | --- | --- | --- |
| Browser to ingress | Session cookie, form/search data, provider and authorization views | Server-side session and role checks; same-origin checks on writes | TLS required in production | Browser cache disabled for authenticated responses; no local/session storage |
| VPN to ingress | Private application traffic | VPN policy and private DNS are IT-owned | TLS required | Ingress logs; retention owned by IT |
| Ingress to application | Sanitized host, client-IP header, request ID | Only configured proxy CIDRs are trusted | Private network/TLS design is IT-owned | Request ID in logs/audit; raw headers not persisted |
| Application to authentication store | User, password hash, session token, account token fields | Better Auth server adapter | Database transport TLS required in staging/production | PostgreSQL; secrets excluded from UI/logs |
| Application to operational database | Provider facts, authorization work, comments, assignments, audit | Service-layer permission and ownership checks; restricted runtime DB role | Database transport and disk encryption are infrastructure controls | PostgreSQL/PostGIS |
| Workbook to migration service | Potentially sensitive workbook rows and metadata | Migration admin only; preview before apply | Uploaded over protected app connection | Controlled temporary directory during parsing; staged database rows after preview |
| Application to CSV download | Filtered provider rows or migration diagnostics | Explicit export permission; role scope; rate and row limits | TLS to browser | Response is `private, no-store`; short-lived browser blob only |
| Scheduler to application/database | Job type, counts, work/notification records | Controlled process command and advisory lock | Host/database controls | Job execution and audit tables |
| Application to metrics | Route group, method, status, operation, result, timing/count | Operations token on metrics endpoint | TLS/private network required | Process memory then monitoring system if configured |
| Application to logs/error tracking | Request ID, route, error category, release; redacted values | Infrastructure access policy | TLS if forwarded | Current stdout/stderr; external sink not configured |
| Database to backup store | Full database, including deleted-at-backup-time records | Backup service identity | IT must enforce in transit/at rest | Managed backup store; expiry policy not set here |
| Corporate identity provider to app | Corporate identifier, email, approved role/group claims, MFA result | OIDC state/PKCE and approved claim mapping | TLS | User/account/session records; provider tokens require review before storage |

## Sensitive propagation rules

- Member ZIP, diagnosis, authorization, referral, comments, and workbook rows stay inside the protected application/database path unless an approved row-level export explicitly includes them.
- Provider directory CSV omits diagnosis values, comments, notes, coordinates, source provenance, version fields, staff identity, and audit metadata.
- Migration diagnostics CSV can contain source-row context. It is limited to migration administrators and marked confidential.
- Notifications say that work or a summary is ready. They do not repeat member, diagnosis, authorization, comment, or provider detail.
- Digests contain counts by permitted category. They are generated per recipient and role.
- Metrics accept a fixed, low-cardinality label list. Email, user ID, provider, diagnosis, comments, and filter values are rejected by design.
- Logs redact secret keys, email, member, diagnosis, referral, phone, address, facility, comments, notes, cookies, tokens, and connection strings.

## Workbook boundary

Workbooks are untrusted input. The parser enforces archive, size, row, column, shared-string, compression, and formula limits. Macros are rejected. Formula cells use saved values only and produce diagnostics. Temporary files use an operating-system temporary directory and are removed after parsing. Staged raw rows can still contain sensitive data and remain migration-admin only.

## Browser boundary

The application does not use `localStorage`, `sessionStorage`, IndexedDB, service workers, or the browser Cache API. Authentication uses an HTTP-only cookie. Authenticated responses default to `private, no-store`; downloads add `max-age=0` and `nosniff`. On logout or session expiry, a restored page cannot make an authorized request and protected navigation returns to sign-in. Browser screenshots, printing, downloads, and user-initiated clipboard copies remain endpoint/workstation risks and belong in workforce and endpoint policy.

## External validation still required

The repository cannot prove VPN isolation, private DNS, direct-origin blocking, TLS configuration, database TLS/disk encryption, centralized log retention, egress restrictions, backup encryption/expiry, endpoint DLP, or identity-provider MFA. IT must validate those controls in staging and preserve the results with the release evidence.
