# Workbook Reverse Engineering

## Verified source files

The implementation was verified against the current `.xlsx` files without modifying them:

- `URA_Provider_Availability_Tracker_ADMIN_MASTER.xlsx` — 1,647,937 bytes; SHA-256 `bdde4943a977c0b28a57a1bb7e9302040dd784454ea467b2d2750a078a662b43`
- `URA_Provider_Availability_Tracker_USER_ACTIVE.xlsx` — 2,622,475 bytes; SHA-256 `1c646a1f3ebb413badfc564c77b220fdb0ba19b3037c5154079a57e33dcfaf80`

The large macro-enabled backup files are not migration inputs. They remain useful for historical macro review, but the current XLSX files are the canonical migration source.

## Admin workbook

Ten sheets are present:

| Sheet | Verified operational range | Migration use |
|---|---:|---|
| Facilities | A1:Q487 | canonical master, queue inputs, coordinates |
| Facility-Specialty Map | A1:D466 | canonical mapping and treatment status |
| tblWeeklyCallLog | A1:AC4746 | current operational call evidence |
| Weekly Report Snapshot | A1:AS180 | derived output; do not import |
| Monthly Archive | A1:O527 | historical source rows plus a malformed pasted block |
| Zip Coordinates | A1:C5714 | ZIP centroid reference |
| Monthly Report Snapshot | A1:N256 | derived output; do not import |
| Monthly Report Archive | A1:H369 | derived output; do not import |
| Scheduling Trend Tracker | A1:G44 | derived output; generate from calls |
| _Config | A1:B1 | workbook configuration only |

The weekly call log has 29 columns. Supported operational columns record the caller, timestamp, LOB, authorization, facility, specialty, diagnosis code/description, phone, DNVM, accepting/treating/scheduling results, booking time, notes, and output phrase. Columns R:AC are timing, duplicate, recommendation, and other workbook-only helpers. Unused legacy columns are ignored.

The archive contains a paste-marker row and a later block whose cells are shifted left (date appears under initials and subsequent fields no longer match the header). The importer quarantines those rows instead of positionally importing corrupted values.

## User workbook

Eight sheets are present:

| Sheet | Verified range | Migration use |
|---|---:|---|
| Provider search | A1:O28 | derived/search UI; replace with a database query |
| Weekly Call Log | A1:AC5001 | user-entered operational calls |
| tbl30DayLookBack | A1:AO9471 | derived formulas; do not import |
| Authorization Output | A1:X36 | derived narrative; do not import |
| Lists | A1:J35 | validation lists; canonical values derive from source rows/admin configuration |
| Facilities | A1:Y703 | user copy of facility master |
| Facility-Specialty Map | A1:D338 | user copy of mappings |
| Zip Coordinates | A1:C5714 | ZIP centroid reference |

The user and admin call logs place supported fields in different columns. The importer maps supported normalized header names and never assumes fixed positions.

The Authorization Output formulas still reference old positional columns, so shifted cells can be read as a reason or outcome. The web narrative is generated from named canonical fields and stops after the second successful provider.

## Reconciliation results

The verified dry run completed without a database write:

| Entity | Raw rows | Canonical rows | Notes |
|---|---:|---:|---|
| Facilities | 955 | 453 | admin takes precedence; user fills missing fields |
| Facility-specialty mappings | 799 | 455 | 329 overlap between normalized admin/user pairs |
| Calls | 1,209 | 674 | 535 exact duplicates removed across sources |
| ZIP centroids | 11,426 | 5,713 | identical admin/user reference sets reconciled |

Additional findings:

- 268 malformed/incomplete archive rows are rejected and retained in row-level staging for review.
- 7 valid calls reference facilities not found in either current master and are flagged for reconciliation.
- cached workbook result phrases are compared with, but never override, canonical rule output.
- normalization repairs `Unkown`/`Unknown`, `NA`/`N/A`, nonbreaking-space/`Â` artifacts, inconsistent pipe spacing, ZIP types, and phone formatting.

## Performance bottlenecks replaced

- roughly 75,000 live formulas in the user workbook
- forced full recalculation and iterative/circular timestamp formulas
- whole-column and 1,048,576-row table/validation ranges
- fixed 1,001/2,001/3,001/5,001 formula ceilings
- duplicated admin/user masters and report caches
- workbook object-model inspection of the user file exhausted about 4 GB; the production importer instead streams selected XML rows and completes the real-file preview in seconds

## Migration boundaries

Imported source sheets: facility masters, facility-specialty maps, admin/user call logs, admin monthly archive, and ZIP centroids.

Not imported as facts: report snapshots, provider-search output, 30-day lookback, authorization output, helper columns, broken names, cached report cells, and macro code. Those are replaced by database queries, versioned business rules, and explicit application workflows.
