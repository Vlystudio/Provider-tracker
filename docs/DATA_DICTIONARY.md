# Data Dictionary

## Core entities

### users

Stores authenticated staff with role-based access and URA initials for workflow continuity.

- id: UUID primary key
- email: email identity
- name / display_name: Auth profile name plus optional UI override
- initials: unique active user key, mapped to workbook initials
- role: admin | ura_user | report_viewer | auditor
- is_active: disabled users are filtered from active workflows
- created_at / updated_at

Auth-compatible `accounts`, `sessions`, and `verification_tokens` tables are included so the authentication adapter can be added without reshaping operational data.

### facilities

Canonical facility master record.

- id
- facility_name
- city
- normalized_name
- normalized_city
- display_key: `Name | City`
- phone_raw / phone_normalized
- postal_code
- latitude / longitude
- geog_point
- coordinate_provenance
- active
- source_metadata
- optimistic_lock_version

### facility_specialties

Facility-to-specialty mapping with evidence and treatment status.

- facility_id
- specialty_id
- treatment_status
- notes
- last_confirmed_at
- confirming_call_id
- source_metadata

### authorizations

Authorization context reused across multiple call attempts.

- id
- authorization_number
- lob_id
- default_diagnosis_id
- default_specialty_id
- referral_reason_id
- member_postal_code
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
- diagnosis_snapshot_id
- specialty_snapshot_id
- phone_snapshot
- did_not_leave_vm
- accepting_new_patients
- can_treat_diagnosis
- can_schedule_within_four_weeks
- booking_out_bucket_id
- notes
- referral_reason_snapshot_id
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
- referral_reasons
- booking_out_buckets
- postal_code_centroids

## Derived reporting tables

- latest_facility_observations
- latest_facility_specialty_diagnosis_observations
- facility_review_queue
- latest_fdm_eligible_observations
- weekly_duplicate_groups
- authorization_summary_stats
- scheduling_trend_observations

## Audit and import tables

- audit_events
- import_batches: one record per source hash + importer version, with pending/staged/applied/failed state
- import_row_results: raw/normalized row payload, source sheet/row, entity type, fingerprint, status, and issues
- report_snapshots: immutable period/type metrics used for reproducible exports
