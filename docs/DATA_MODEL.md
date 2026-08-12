# Data Model

Business records use UUID primary keys. Django's authentication user remains the identity anchor, with `UserProfile` storing URA initials, display name, role, and activity state.

## Reference records

- `LineOfBusiness`
- `Specialty`
- `Diagnosis`
- `ReferralReason`
- `BookingOutBucket`
- `PostalCodeCentroid`

Normalized reference names support stable matching while retaining a clean display value.

## Operational records

- `Facility`: canonical identity, contact/location, numeric coordinates, quality status, provenance, and active state.
- `FacilitySpecialty`: confirmed mapping, treatment status, notes, and source evidence.
- `Authorization`: referral context shared by related call attempts.
- `ProviderCall`: timestamped availability evidence, result code/phrase, recommendation, FDM fields, repeat reason, review date, and import provenance.
- `DuplicateCallGroup`: facility + diagnosis + week warning state.
- `ReviewTask`: assigned, prioritized, due-dated follow-up or data-quality work.

## Governance and automation

- `ImportBatch` is unique by source hash and importer version.
- `ImportRowResult` retains accepted or quarantined row evidence; raw data is restricted to authorized roles.
- `AuditEvent` records material changes with a non-sensitive summary.
- `ReportSnapshot` preserves period metrics behind a stable fingerprint.
- `AutomationRule` describes a trigger or schedule.
- `AutomationRun` records outcome, affected count, details, and idempotency key.

Common facility, ZIP, status, result, date, caller, authorization, review, and relationship filters are indexed. List views use server pagination and relation prefetching.
