# Data classification

Last reviewed: 2026-08-22

This document covers all 42 application tables in `src/db/schema.ts`. It describes what the application can hold. It does not decide whether the organization is a HIPAA covered entity or business associate.

## Classification labels

| Label | Use |
| --- | --- |
| Public | Material that may be released without access control. No database table is public. |
| Internal | Low-risk configuration and reference data used by staff. |
| Confidential operational | Provider availability, contact, migration, work assignment, and reporting records. |
| Employee PII | Staff names, email addresses, access state, and work attribution. |
| Authentication/security | Password hashes, session tokens, verification tokens, rate-limit keys, security events, and network correlation values. |
| Potential PHI | Health or payment-related information that becomes PHI when it identifies, or can reasonably identify, a person and is held by a regulated entity or business associate. |
| Secret | A credential that grants access. Secrets never belong in logs, exports, metrics, source control, or evidence packages. |

## PHI assessment

Provider Tracker is PHI-capable.

The current schema does not store a member name, date of birth, Social Security number, or medical record number. It does store authorization numbers, member ZIP codes, diagnosis selections, and operational free text. Those fields can become individually identifiable health information when an authorization number or another linked system can identify the member. Free text can also introduce names or medical details that the structured schema did not ask for.

HHS defines PHI as individually identifiable health information held or transmitted by a covered entity or business associate. The organizational role and actual production data determine whether HIPAA applies. See the [HHS Privacy Rule summary](https://www.hhs.gov/hipaa/for-professionals/privacy/laws-regulations/index.html).

Working rule for this application: treat authorization records, member-location filters, diagnosis-linked work, workbook rows, comments, notes, migration diagnostics, and row-level exports as potentially sensitive until the privacy/compliance owner approves a narrower classification.

## Table inventory

`Retained` means no application deletion is active. `Policy-gated` means the repository has a dry-run and approval path, but no deletion runs until an authorized policy is entered.

| Table | Purpose | Classification | PHI/PII notes | Main access | Current retention |
| --- | --- | --- | --- | --- | --- |
| `users` | Staff identity and role | Employee PII | Name, email, role, sign-in/access dates | Admin; auditor through governance review | Retained |
| `accounts` | Login method and password/token material | Secret; authentication | Password hashes; future identity-provider tokens | Authentication service only | Retained; vendor/token policy pending |
| `sessions` | Active server sessions | Secret; authentication | Token is secret; stored network value is HMAC-derived; user agent is forced null | Authentication service; admin sees dates only | Policy-gated after expiry |
| `verification_tokens` | Short-lived verification/reset values | Secret; authentication | Token value is secret | Authentication service only | Policy-gated after expiry |
| `auth_rate_limits` | Brute-force controls | Authentication/security | Key may be user-linked but is not shown in UI | Authentication service only | Policy-gated when inactive |
| `lines_of_business` | Business-line reference list | Internal | Can add health-plan context when joined | Operational roles | Retained |
| `specialties` | Provider specialty reference list | Internal | Health context, not patient data alone | Operational/report roles | Retained |
| `diagnoses` | Diagnosis code reference list | Confidential operational | Not PHI alone; sensitive when tied to a member or authorization | Operational/report roles as scoped | Retained |
| `booking_out_buckets` | Wait-time reference bands | Internal | No direct identifier | Operational/report roles | Retained |
| `postal_code_centroids` | Distance-search reference data | Internal | Not member data; a searched member ZIP may be sensitive | Operational service | Retained |
| `facilities` | Provider directory and current status | Confidential operational | Provider address/phone; no patient data by design | Admin and URA row access; reports aggregate | Retained; archive state enforced |
| `authorizations` | Authorization workflow | Potential PHI | Authorization number, member ZIP, diagnosis/specialty links | Creator and admin; no report-viewer row access | Retained pending approved policy |
| `import_batches` | Workbook import summary | Confidential operational | File name/hash and summary may expose source context | Migration administrators | Retained pending migration policy |
| `migration_runs` | Preview, approval, apply, reconcile, reverse | Confidential operational; audit | Reasons and diagnostics may contain sensitive context | Migration administrators | Retained |
| `migration_sources` | Workbook provenance | Confidential operational | Source file name/hash, sheet metadata | Migration administrators | Retained |
| `migration_diagnostics` | Row-level migration issues | Potential PHI | Sheet/row keys, messages, resolution notes can repeat workbook content | Migration administrators | Retained pending approved policy |
| `legacy_actors` | Attribution mapping from workbooks | Employee PII | Legacy staff names and user mapping | Migration administrators/auditors as needed | Retained |
| `legacy_value_mappings` | Approved legacy-to-current value mapping | Confidential operational | Can include health/provider labels | Migration administrators | Retained |
| `migration_reconciliations` | Source-versus-target counts and hashes | Confidential operational | Counts generally safe; details remain migration-restricted | Migration administrators | Retained |
| `calls` | Imported call/authorization history | Potential PHI | Authorization, diagnosis, location, provider, notes | Admin/URA within workflow | Retained pending approved policy |
| `facility_specialties` | Facility capability | Confidential operational | Notes are free text | Operational roles; report aggregates | Retained |
| `facility_diagnosis_capabilities` | Facility capability by diagnosis | Confidential operational | Diagnosis data, notes; not member-linked by design | Operational roles; report aggregates | Retained |
| `facility_verification_events` | Immutable verification history | Confidential operational | Contact person/channel and comments may contain PII/PHI | Operational roles; auditor sees audit metadata, not full comments | Retained |
| `facility_contact_attempts` | Contact history | Confidential operational | Contact person/channel and comments | Operational roles | Retained |
| `reverification_assignments` | Review work assignment | Employee PII; confidential operational | Staff assignment and provider target | Assignee/admin | Retained |
| `facility_duplicate_candidates` | Duplicate review | Confidential operational | Review note is free text | Admin | Retained |
| `facility_merge_records` | Merge and undo history | Confidential operational; audit | Reason and restore snapshot can contain provider data | Admin | Retained |
| `import_row_results` | Raw and normalized workbook rows | Potential PHI | `raw_data` can contain the full source row | Migration administrators only | Retained pending approved policy |
| `report_snapshots` | Historical report results | Confidential operational | Filters can become sensitive; metrics should remain aggregate | Report roles | Retained |
| `audit_events` | Accountability and investigation | Authentication/security; employee PII | Actor, target, action, result, safe field names; no full comments or request bodies | Admin/auditor | Retained; append-only runtime privilege |
| `access_review_decisions` | Quarterly access decisions | Employee PII; audit | Role/status/sign-in snapshot and human decision; no narrative | Admin writes; admin/auditor reads | Retained |
| `data_retention_policies` | Approved technical retention settings | Internal; security configuration | Policy reference and approver only; no policy document content | Admin writes; admin/auditor reads | Retained |
| `data_retention_holds` | Prevent eligible deletion | Confidential governance | Category, optional record ID, reason code; no case narrative | Admin writes; admin/auditor reads | Retained |
| `automation_job_executions` | Job status and counts | Internal; audit telemetry | Error message is bounded but still redacted before logging | Admin | Retained pending job-history policy |
| `notification_preferences` | User delivery choices | Employee PII | User ID and categories | Record owner | Retained with account |
| `notifications` | In-app work notices | Confidential operational | Messages are intentionally generic; recipient-scoped | Recipient only | Retained pending notification policy |
| `operational_work_items` | Assigned work queue | Employee PII; confidential operational | Provider target, assignee, reason codes, dismissal text | Assignee/admin | Retained pending work-history policy |
| `operational_change_events` | Material provider changes | Confidential operational | Before/after values are provider facts, not member facts | Operational/report roles by service | Retained |
| `coverage_watches` | Coverage thresholds | Confidential operational | Diagnosis/specialty and location filters | Admin manages; authorized roles read | Retained |
| `coverage_alert_events` | Coverage state changes | Confidential operational | Aggregate counts can disclose low coverage | Authorized report/coverage roles | Retained |
| `operational_digests` | Recipient-specific aggregate summaries | Confidential operational | Counts only; recipient-scoped | Recipient only | Retained pending digest policy |
| `automation_settings` | Job configuration | Internal; security-relevant configuration | Actor and change time | Admin | Retained |

## Free-text locations

The following fields accept or preserve free text: facility capability notes; verification/contact comments; call notes; migration approval/reversal reasons, diagnostic messages/resolution notes; duplicate/merge review reasons; work-item blocked/dismissal reasons; source metadata; imported raw rows; notification text; automation errors.

UI guidance is simple: do not enter member names, dates of birth, credentials, or extra medical detail unless the approved workflow specifically requires it. The application does not use keyword censorship because it would be unreliable and would interfere with legitimate work.

Free text is not copied into metrics. Audit events store the fact that a reason or note was supplied, not the narrative. Notifications and digests use counts or generic prompts. Row-level exports omit comments and notes. Migration diagnostic export remains admin-only because its purpose requires the diagnostic text.

## Minimum-necessary review

| Finding | Decision |
| --- | --- |
| Session raw IP and user agent were more data than the UI or session control needed. | New sessions store an HMAC-derived network identifier and force user agent to null. Audit correlation remains available. |
| User image is not used by the current UI. | Keep the standard authentication column for compatibility, but do not request or display it. Review before corporate identity mapping. |
| OAuth access/refresh/ID token columns are unused for local credentials. | Keep for the approved future identity integration. They are secrets, never exported, and require secret/encryption design before use. Better Auth does not encrypt provider tokens by default. |
| Authorization number, member ZIP, diagnosis, and specialty support the defined URA workflow. | Keep, but restrict row access to the creator/admin service rules. Report viewers receive aggregates rather than authorization rows. |
| Provider coordinates, phone, address, and verification history support distance search and verification. | Keep. Exports omit exact coordinates, provenance internals, optimistic-lock versions, and audit metadata. |
| Imported raw rows and migration diagnostics duplicate source content. | Keep while migration/cutover evidence is required. They remain migration-admin only; an approved retention decision is still needed. |
| Audit before/after snapshots could become a shadow data copy. | Current write paths store safe state codes/counts or changed-field names. Full comments, request bodies, search values, and exported content are excluded. |
| Account and access-review history includes employee PII. | Keep for access governance and attribution. Governance screens omit session tokens, raw/HMAC network values, password fields, and internal authentication IDs. |

No clearly unnecessary historical business field was deleted in Phase 10. Removing workbook-era fields without the data owner could break reconciliation and evidence. The remaining candidates above need the operational, identity, and privacy owners to decide.

## Backup effect

Deleting a live record does not remove copies from existing backups. A record can remain recoverable until the applicable backup expires. Restore procedures must reapply current account disablement, holds, and post-backup changes before a restored database is used.
