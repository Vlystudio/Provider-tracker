# Import Process

## Preview

A preview checks the file container and required sheets, calculates the file hash, reads selected XML rows, cleans the headers and values, matches records from the available sources, and returns a summary with private details removed. It does not write to the database or change the workbook.

## Import

Importing runs the same checks again inside a database transaction. The file hash and importer version prevent the same batch from being added twice. Call fingerprints prevent duplicate calls. Administrators and auditors can review the source sheet, row number, fingerprint, status, parsed values, original values, and issue codes.

## Source order

When the same record appears more than once, this order is used:

1. Admin weekly call log
2. Admin facility and mapping lists
3. User weekly call log
4. Admin monthly archive
5. User facility and mapping copies

Lower-priority facility rows can fill a missing phone number or location, but they do not rename the preferred record.

## Value cleanup

The importer repairs nonbreaking spaces and known encoding problems, makes pipe spacing consistent, treats `Unkown` as `Unknown`, handles `NA` and `N/A` the same way, keeps ZIP codes at five characters, and stores both the original and cleaned phone number. A result copied from a workbook is retained only for reconciliation; the site calculates the saved result.

## Rejected rows

Rows are rejected when a facility or call time is missing, coordinates are invalid, a mapping is incomplete, an archive section is malformed, or the workbook fails a file safety or size check. During an explicit import, a call whose facility is missing from the facility lists can use a clearly marked placeholder that must be reviewed.

## Import page

The Data Import page accepts `.xlsx` and `.xlsm` files up to 100 MB. It cleans displayed filenames, supports preview and import actions, shows counts and issues, and limits original row details to administrators and auditors.
