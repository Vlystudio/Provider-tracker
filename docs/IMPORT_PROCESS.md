# Import Process

## Preview

Preview validates the container, recognizes required sheets, hashes the file, streams selected XML rows, normalizes headers and values, stages row outcomes in memory, reconciles source priority, and returns a redacted summary. It performs no canonical database writes and never modifies the workbook.

## Apply

Apply repeats the same deterministic plan inside a database transaction. Source hash + importer version prevents repeated batches; call fingerprints prevent repeated operational evidence. Row results retain source sheet, row, fingerprint, status, normalized values, raw evidence, and issue codes behind administrator/auditor permissions.

## Source precedence

1. Admin weekly call log.
2. Admin facility and mapping masters.
3. User weekly call log.
4. Admin monthly archive.
5. User facility and mapping copies.

Lower-priority facility rows may fill missing contact or location fields but do not rename the preferred record.

## Normalization

The importer repairs nonbreaking spaces and encoding artifacts, normalizes pipe spacing, treats `Unkown` as `Unknown`, treats `NA` and `N/A` consistently, preserves ZIPs as five characters, and stores both original and normalized phone values. Cached result text is comparison evidence only.

## Quarantine conditions

Missing facility or timestamp, invalid ZIP coordinates, incomplete mappings, malformed archive blocks, unsafe archives, excessive sizes, missing sheets, and invalid containers are rejected safely. Canonical calls with a facility missing from the masters use a review-required placeholder only during explicit apply.

## UI intake

Import Center accepts `.xlsx` and `.xlsm`, sanitizes displayed filenames, limits uploads to 100 MB, offers preview and explicit apply actions, shows hashes/counts/issues/history, and restricts row detail to administrators and auditors.
