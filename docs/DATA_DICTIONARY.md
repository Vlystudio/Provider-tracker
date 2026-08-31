# Data Dictionary

## Migration and legacy history

| Table | Purpose |
| --- | --- |
| `migration_runs` | One preview/apply/reconciliation lifecycle with approvers, release, readiness, baseline, failure, and reversal fields. |
| `migration_sources` | Sanitized source filename, SHA-256 hash, size, workbook kind, schema version, sheet facts, formulas, and hidden rows. |
| `migration_diagnostics` | Row-level matching, mapping, validation, review decision, target, note, reviewer, and optimistic version. |
| `migration_reconciliations` | Explained-row totals, relationship totals, answer-state distribution, report comparison, discrepancies, and readiness. |
| `legacy_actors` | Historical workbook identity kept separately from current login accounts, with an optional reviewed user link. |
| `legacy_value_mappings` | Reusable specialty, diagnosis, and actor mapping decisions. |

`import_batches.migration_run_id` connects applied batches to the reviewed run. Calls, verification events, and contact attempts may carry `legacy_actor_id`. `facilities.migration_baseline_at` prevents initial imported backlog from creating a notification flood.

## Core entities

### users

Stores authenticated staff with role-based access and staff initials for current workflows. Historical workbook initials stay in `legacy_actors` unless a reviewed exact match links them.

- id: UUID primary key
- email: email identity
- name / display_name: Auth profile name plus optional UI override
- initials: unique active user key, mapped to workbook initials
- role: admin | ura_user | report_viewer | auditor
- is_active: disabled users are filtered from active workflows
- created_at / updated_at

Better Auth uses the `accounts`, `sessions`, `verification_tokens`, and `auth_rate_limits` tables. Credential accounts are scoped by issuer, and session records are deleted when the related user is deleted.

### facilities

Canonical facility master record.

- id
- facility_name
- address_line_1 / address_line_2 / city / state_code / postal_code
- normalized_name
- normalized_city
- display_key: `Name | City`
- phone_raw / phone_normalized
- postal_code
- latitude / longitude
- geog_point
- coordinate_provenance
- coordinate_quality: exact | address | zip_centroid | manual | unknown
- current_accepting_status / accepting_verified_at
- current_scheduling_status / scheduling_verified_at
- current_urgent_referral_status: whether an urgent referral is required for this provider's availability
- next_available_date / estimated_wait_days
- last_verified_at
- merged_into_facility_id / archived_at / archived_by
- active
- source_metadata
- optimistic_lock_version

### facility_specialties

Facility-to-specialty mapping with evidence and treatment status.

- facility_id
- specialty_id
- treatment_status
- verification_status
- active
- notes
- last_confirmed_at
- confirming_call_id
- source_metadata
- optimistic_lock_version

### facility_diagnosis_capabilities

Explicit facility-to-diagnosis treatment evidence. A specialty match does not create this relationship.

- facility_id / diagnosis_id
- status: yes | no | unknown | not_asked | unable_to_verify | not_applicable
- active
- notes
- last_verified_at
- source_metadata
- optimistic_lock_version

### facility_verification_events

Append-only verification history. Fields are optional so one event can update only the facts that were checked.

- facility_id / verified_at / verified_by
- method: phone | fax | portal | website | email | internal_source | other
- confidence: direct | authoritative | secondary | unverified
- accepting_status
- specialty_id / specialty_status
- diagnosis_id / diagnosis_status
- scheduling_within_four_weeks
- urgent_referral_status: the verified provider requirement; Provider Tracker does not create or submit referrals
- next_available_date / estimated_wait_days
- comments
- related_call_id / import_batch_id
- previous_state / resulting_state
- source_metadata

### facility_contact_attempts

Contact activity that may not have produced verified information.

- facility_id / attempted_at / attempted_by
- method
- outcome: verified | no_answer | voicemail_left | voicemail_not_left | disconnected | wrong_number | fax_only | callback_requested | unable_to_verify
- comments
- related_call_id

### reverification_assignments

Assignment history for queue work. Only one open assignment is allowed per facility.

- facility_id / assigned_to / assigned_by
- status: open | completed | dismissed
- reason_codes
- completed_at / completed_by

### facility_duplicate_candidates and facility_merge_records

Candidate rows store ordered facility pairs, confidence, deterministic score, reason codes, and a human decision. Merge records retain the survivor, archived source, actor, reason, recovery snapshot, and optional undo metadata.

### authorizations

Authorization context reused across multiple call attempts.

- id (the database-generated UUID displayed as the Tracking ID)
- lob_id
- member_zip
- created_by
- status
- created_at / updated_at

### calls

Operational evidence record created from a facility contact attempt.

- id
- authorization_id
- facility_id
- caller_user_id
- call_at
- caller_initials_snapshot
- lob_snapshot
- diagnosis_snapshot_id
- specialty_snapshot_id
- phone_snapshot
- did_not_leave_vm
- accepting_new_patients
- can_treat_diagnosis
- can_schedule_within_four_weeks
- notes
- result_code
- result_phrase
- rule_version
- source_workbook
- source_sheet
- source_row
- import_fingerprint: immutable call-level idempotency key
- source_metadata: source hash, logical fingerprint, cached result, and row issues
- created_at / updated_at

## Reference data

- lines_of_business
- specialties
- diagnoses
- postal_code_centroids

## Derived query models

- latest_facility_observations
- latest_facility_specialty_diagnosis_observations
- facility_review_queue
- weekly_duplicate_groups
- authorization_summary_stats
- scheduling_trend_observations
- verification freshness and reverification priority
- data-quality issue groups
- search ranking reasons
- accepting/contact/verification trends
- specialty coverage counts

## Audit and import tables

- audit_events
- import_batches: one record per source hash + importer version, with pending/staged/applied/failed state
- import_row_results: raw/normalized row payload, source sheet/row, entity type, fingerprint, status, and issues
- report_snapshots: immutable period/type metrics used for reproducible exports
