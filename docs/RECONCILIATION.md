# Migration reconciliation

Reconciliation answers one question: can every operational source row be explained?

## Row equation

For each run:

```text
source rows = imported + updated + unchanged + skipped + conflict + invalid
reconciliation percent = reconciled rows / source rows × 100
```

Scaffold rows are counted separately because they do not contain an operational record. Empty formatted rows are never counted as successful imports.

| State | Meaning |
| --- | --- |
| Imported | A new canonical row or relationship was written. |
| Updated | An older, unverified database field was safely filled from the source. |
| Unchanged | The row was already applied or was an exact duplicate. |
| Skipped | A reviewer explicitly excluded the row. |
| Conflict | A match or mapping still needs a decision. |
| Invalid | Required data or a valid date/status could not be read. |

A run is `no_go` when an error diagnostic remains open or deferred, a row is unaccounted for, or report parity fails. Warnings produce `go_with_warnings`. A clean run is `go`.

## Required comparisons

- workbook rows visited and scaffold rows;
- unique facilities, facility-specialty relationships, calls, and postal codes;
- exact duplicate calls and possible cross-workbook duplicates;
- unresolved facility, specialty, and diagnosis references;
- yes, no, unknown, blank, not asked, unable to verify, and not applicable counts;
- call totals and accepting-status distribution in the source plan versus imported calls;
- accepting-rate denominator, which is yes plus no only;
- source hashes, schema version, sheet names, hidden rows, and formula cells;
- imported relationship counts and foreign-key integrity.

## Review sequence

1. Export diagnostics from the migration run.
2. Work errors before warnings.
3. Resolve ambiguous facilities against the production provider directory.
4. Confirm new specialties and diagnosis codes with the operational owner.
5. Record a note for every use-existing, create, skip, or defer decision.
6. Run a new preview when either workbook changes. Do not reuse decisions against a new hash.
7. After apply, compare the stored reconciliation and application reports with the approved preview.

The CSV export protects spreadsheet consumers from formula injection by prefixing cells that begin with `=`, `+`, `-`, or `@`.
