# Workbook Analysis

## Files checked

The importer was tested against the current admin and user `.xlsx` workbooks without changing either file. Macro-enabled backup files are kept only as reference material and are not import sources.

The importer reads facility lists, facility-specialty mappings, weekly call logs, valid monthly archive calls, ZIP centroids, and reference lists. Search output, report sheets, helper columns, cached formulas, and macros are not imported. The site calculates those results itself.

## Sheet structure

The admin workbook contains Facilities, Facility-Specialty Map, `tblWeeklyCallLog`, Weekly Report Snapshot, Monthly Archive, Zip Coordinates, Monthly Report Snapshot, Monthly Report Archive, Scheduling Trend Tracker, and `_Config`.

The user workbook contains Provider search, Weekly Call Log, `tbl30DayLookBack`, Authorization Output, Lists, Facilities, Facility-Specialty Map, and Zip Coordinates.

The user call log has `Booking Out` in column N and `Notes` in O. The admin log has `Notes` in N and `Referral Type` in O. For that reason, the importer matches normalized header names instead of fixed column positions.

## Preview totals

The current preview reads 23,681 XML rows and reports:

| Record type | Accepted source rows | Records after matching and deduplication |
|---|---:|---:|
| Facilities | 955 | 453 |
| Facility-specialty mappings | 799 | 455 |
| Provider calls | 1,209 | 632 |
| ZIP centroids | 11,426 | 5,713 |

The preview rejects 268 malformed or incomplete archive rows, removes 577 duplicate calls found across the two workbooks, finds six calls whose facility is missing from the current facility lists, and finds five mappings whose facility is missing.

## Date and coordinate handling

Dates such as `4/23/26 4:05 PM` are parsed as ordinary month/day/year timestamps. This keeps 42 user calls aligned with their matching admin archive calls and produces the 632-call total above.

Blank coordinate cells remain blank. They are not converted to numeric zero. The preview flags 591 source facility rows that need a coordinate fallback or review.

## File limits and safety checks

- The user workbook contains about 75,000 formulas and oversized worksheet/table ranges.
- The importer reads only selected XML sheet entries and clears rows from memory as it goes.
- Compressed uploads default to 100 MB, expanded content to 512 MB, and each source sheet to 100,000 rows.
- Invalid paths, containers, metadata, workbook types, or required sheets fail before a database write.
- Cached result phrases may be retained for reconciliation, but the site always calculates the saved result.
- Preview and import do not modify either source workbook.
