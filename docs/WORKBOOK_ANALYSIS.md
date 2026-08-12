# Workbook Analysis

## Sources and boundaries

The importer was verified against the current admin and user `.xlsx` workbooks in read-only mode. Macro-enabled backups are historical references and are not canonical inputs.

Canonical input sheets are facility masters, facility-specialty mappings, weekly call logs, valid monthly archive calls, ZIP centroids, and reference values. Search output, 30-day lookback formulas, authorization output, report snapshots, trend formulas, helper columns, cached formula output, broken names, and macro behavior are rebuilt in application code.

## Verified sheet structure

The admin workbook contains Facilities, Facility-Specialty Map, `tblWeeklyCallLog`, Weekly Report Snapshot, Monthly Archive, Zip Coordinates, Monthly Report Snapshot, Monthly Report Archive, Scheduling Trend Tracker, and `_Config`.

The user workbook contains Provider search, Weekly Call Log, `tbl30DayLookBack`, Authorization Output, Lists, Facilities, Facility-Specialty Map, and Zip Coordinates.

The user call log has `Booking Out` in column N and `Notes` in O. The admin log has `Notes` in N and `Referral Type` in O. Import mapping is therefore based on normalized header names, never fixed positions.

## Reconciliation results

The current Python preview reads 23,681 XML rows and reports:

| Entity | Raw accepted rows | Corrected canonical rows |
|---|---:|---:|
| Facilities | 955 | 453 |
| Facility-specialty mappings | 799 | 455 |
| Provider calls | 1,209 | 632 |
| ZIP centroids | 11,426 | 5,713 |

It quarantines 268 malformed or incomplete archive rows, removes 577 exact cross-workbook call duplicates, identifies six canonical calls whose facility is absent from the current masters, and identifies five mappings with an absent facility relationship.

## Correction to the earlier investigation

An earlier implementation reported 674 canonical calls, 535 duplicates, and seven unresolved call-facility relationships. Re-running both parsers isolated the difference to 42 user timestamp strings. Dates such as `4/23/26 4:05 PM` were stripped to eight digits before normal date parsing and interpreted as a year in the 6000s. Those rows then failed to match their identical admin archive calls.

The Python parser applies normal month/day/year parsing first, producing valid 2026 timestamps. The affected rows correctly reconcile as duplicates, resulting in 632 canonical calls, 577 duplicates removed, and six unresolved call-facility relationships.

The earlier parser also converted blank coordinate cells to numeric zero. The Python importer retains them as missing and flags 591 raw facility rows for coordinate fallback or review. This is intentional data-quality preservation, not a regression.

## Performance and safety findings

- The user workbook contains roughly 75,000 live formulas and oversized worksheet/table ranges.
- The importer reads only selected XML sheet entries and clears parsed row elements as it advances.
- Compressed uploads default to 100 MB, expanded content to 512 MB, and each source sheet to 100,000 rows.
- ZIP traversal paths, invalid containers, missing metadata, wrong workbook recognition, and unsafe file types fail before a database write.
- Cached workbook result phrases are preserved for comparison but never override canonical rule calculations.
- Neither source workbook is modified during preview or apply.
