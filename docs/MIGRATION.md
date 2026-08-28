# Legacy workbook migration

The migration screen is at `/migration`. Only administrators can open it or call its APIs.

## Required files

The importer accepts macro-free `.xlsx` files only. Use the last approved Admin Master and User Active workbooks. Do not rename sheets, add export-only tabs, or change the header row after the final preview.

The current schema identifier is `provider-workbook-v2`. Expected sheets are listed in [LEGACY_DATA_MAPPING.md](LEGACY_DATA_MAPPING.md).

## Process

1. Read the XLSX package without running Excel, formulas, macros, links, or embedded objects.
2. Check the filename, compressed size, expanded size, ZIP paths, relationships, sheet names, headers, row limits, formulas, and hidden rows.
3. Normalize text, phone numbers, ZIP codes, dates, status values, facility keys, specialties, and diagnoses.
4. Match records to existing database rows. Exact matches are automatic. Similar or ambiguous records become review items.
5. Save a preview with file hashes, schema version, counts, sheet details, and diagnostics. Uploaded files are removed from the temporary directory.
6. Resolve blocking items. A reviewer may use an existing record, create a new specialty or diagnosis, skip a source row, or defer the item.
7. Approve the run with a reason and upload the same files again. The SHA-256 hashes and sizes must match the preview.
8. Apply all new rows in one database transaction. A failed transaction is rolled back. An advisory lock prevents two runs from applying the same source files at once.
9. Reconcile source rows, imported relationships, answer-state totals, and report denominators.

Preview and apply are separate actions on purpose. A preview never writes provider, call, or verification records.

## Data handling rules

- Blank, unknown, not asked, unable to verify, and not applicable stay separate.
- Numeric ZIP codes are padded to five digits. ZIP+4 values keep all nine digits.
- Two-digit years and invalid calendar dates are rejected. The importer does not substitute the current date.
- Saved formula values are read, but formulas are never evaluated. Formula cells are shown in the preview.
- Hidden rows are included and called out for review.
- Existing verified phone, address, location, and verification values win over older workbook values.
- A workbook date becomes verification history only when a valid date was present in the source.
- Workbook initials are stored as legacy actors. They are linked to a current active user only when there is one exact initials match. No user account is created from workbook initials.

## Idempotency and resume behavior

An import batch is unique by source SHA-256 hash and importer version. Reapplying the same files does not add calls again. A failed run can be retried after its problem is fixed, using the original preview files.

The import uses chunks for inserts while keeping the whole apply inside one transaction. There is no partially applied run to resume. The next attempt starts the transaction again and reuses stable row fingerprints.

## Reversal

Use the reversal endpoint in dry-run mode first. The current importer can update several related tables, so a material production run requires the cutover backup for an exact rollback. Direct database reversal is limited to a run with no material imported rows and no later activity. The application will not perform a partial reversal that leaves reference data or removes newer work.

## Commands

```text
npm run import:workbooks -- --admin <admin.xlsx> --user <user.xlsx>
npm run import:workbooks -- --admin <admin.xlsx> --user <user.xlsx> --apply
npm run test:migration
npm run test:migration-performance
```

The command-line importer remains available for IT-controlled work. The web screen is preferred for production because it records the previewer, approver, decisions, hashes, reconciliation, and audit events.

## Performance envelope

`npm run test:migration-performance` checks import planning and reconciliation at 1,000, 10,000, and 50,000 rows. It reports elapsed time and heap growth. The limits are intentionally loose enough for ordinary deployment hardware: 5 seconds, 15 seconds, and 60 seconds, with less than 512 MB heap growth.

Run the test on the staging host before cutover. Workbook ZIP parsing time depends on file compression and disk speed, so record the full staging preview time separately.
