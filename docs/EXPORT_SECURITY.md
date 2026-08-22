# Export security

Last reviewed: 2026-08-22

## Export inventory

| Exit point | Role/scope | Data | Controls |
| --- | --- | --- | --- |
| Provider directory CSV | Admin and URA | Current filtered provider rows | POST filters, explicit permission, same service scope, 1–10,000 configured cap, rate limit, warning, audit |
| Migration diagnostics CSV | Migration admin | Diagnostic row text and resolution state for one run | Explicit permission, run ID validation, formula protection, no-store, audit |
| Reports/drilldowns | Admin, URA, report viewer, auditor as role permits | Aggregate metrics and bounded provider drilldown | Server permission, 500-row drilldown cap, no public cache |
| Application APIs/pages | Route-specific | Authorized JSON/HTML views | Authentication, role/ownership checks, no-store default |
| Browser copy/print/screenshot | User-controlled | Visible authorized data | No bulk-copy feature; endpoint/workforce policy needed |
| Migration diagnostics/logs | Admin/infrastructure | Source issue context, safe telemetry | Restricted routes; log redaction |
| Notifications/digests | Recipient only | Generic prompt and counts | Recipient ID and role category checks |
| Database backup/restore | Backup service/IT | Full database | Infrastructure encryption, access, retention, restore controls required |

No generated export is written under `public`, `static`, or another web-served directory.

## Provider directory CSV

The UI warns that the file contains confidential operational data. Filters are sent in a POST body so diagnosis/ZIP values are not added to an export URL. The server runs the same provider-search query and active/non-merged filters used by the source workflow.

Allowed: `admin`, `ura_user`.

Blocked: anonymous, `report_viewer`, `auditor`.

The export includes facility, city/state/ZIP, distance, phone, specialties, availability/scheduling/urgent status, next availability, estimated wait, verification time, and freshness. It omits comments, notes, diagnosis values, coordinates, provenance, assignment data, user data, migration fields, audit data, IDs, and optimistic-lock versions.

`EXPORT_MAX_ROWS` is validated from 1 to 10,000. The normal production template requires an approved export-policy value. The response reports whether matching rows were truncated.

The audit event stores actor, time, export type, row count, total match count, truncation, and names of applied filters. It does not store filter values or CSV content.

## Migration diagnostics CSV

This file can contain workbook-derived diagnostic text. It remains migration-admin only. The filename is date-based and does not contain a run, member, diagnosis, or person identifier. The audit event stores only run target and record count.

## Spreadsheet safety

Every CSV cell is quoted. Text beginning with `=`, `+`, `-`, or `@` receives a leading apostrophe before quoting. This covers attacker-controlled names, comments, labels, notes, and diagnostic fields. Tests inspect the generated cell value and verify no untrusted formula is produced.

## Download headers

Generated CSV responses set:

- `Content-Type: text/csv; charset=utf-8`
- fixed-pattern `Content-Disposition` filename
- `Cache-Control: private, no-store, max-age=0`
- `X-Content-Type-Options: nosniff`
- a sandboxed content security policy
- `X-Data-Classification: confidential-operational`

Downloads have no public/predictable URL. Authorization runs on every POST/GET. Provider CSV exists as a browser blob only long enough to trigger the download; the object URL is revoked immediately.

## Cross-user and IDOR boundary

Provider directory data is role-scoped, not assigned to one URA user, so a User A/User B ownership export does not apply to that endpoint. The application has no assigned-work or authorization-row bulk export. Authorization and work APIs remain creator/assignee scoped.

Migration diagnostic export is run-scoped and admin-only. Direct requests from other roles return 403. Notification and digest APIs are recipient-scoped and do not expose another user’s rows.

## Compromised-account exposure

| Role | Residual retrieval exposure |
| --- | --- |
| URA | Up to the configured provider CSV cap per request; provider search paginated to 100 rows; own authorization/work records |
| Report viewer | Bounded aggregate reports and approved provider drilldowns; no provider CSV or authorization rows |
| Auditor | Audit/governance views and incident reports; no provider CSV or operational mutation |
| Admin | Broad operational/admin/migration access; highest residual exposure and priority for MFA/review |

Rate limits and row caps slow bulk extraction but cannot prevent a compromised authorized user from collecting visible data over time. VPN, MFA, anomaly monitoring, endpoint DLP, egress control, and rapid revocation remain required.

## DLP integration

The application supplies stable classification and audit signals: `/api/exports/*`, CSV content type, `X-Data-Classification`, generic filenames, actor/time/count audit events, and private-only deployment. IT can apply proxy, endpoint, CASB, or DLP rules at those points. The repository does not attempt to create a corporate DLP product.
