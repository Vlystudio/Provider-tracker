# Data Model

Business records use UUID primary keys. Django's user table stores sign-in details, while `UserProfile` stores URA initials, display name, role, and active status.

## Reference tables

- `LineOfBusiness`
- `Specialty`
- `Diagnosis`
- `ReferralReason`
- `BookingOutBucket`
- `PostalCodeCentroid`

Reference values keep a normalized name for matching and a separate display name.

## Main records

- `Facility`: name, contact information, location, coordinates, data-quality status, import source, and active status
- `FacilitySpecialty`: specialty mapping, confirmation status, treatment status, notes, and source
- `Authorization`: referral details shared by its provider calls
- `ProviderCall`: call time, availability answers, result, recommendation, FDM fields, repeat reason, review date, and import details
- `DuplicateCallGroup`: repeat calls for the same facility, diagnosis, and week
- `ReviewTask`: assigned follow-up or data issue with a priority and due date

## Imports, reports, and jobs

- `ImportBatch`: one workbook import, identified by file hash and importer version
- `ImportRowResult`: accepted or rejected source rows; raw values are limited to authorized roles
- `AuditEvent`: important changes with a short, non-sensitive summary
- `ReportSnapshot`: saved report dates and totals
- `AutomationRule`: a scheduled or triggered job definition
- `AutomationRun`: one job result, including its count, details, error, and duplicate-prevention key

Common filters such as facility, ZIP, status, result, date, caller, authorization, review status, and relationships are indexed. Long lists use server-side pagination and related-record prefetching.
