# Importing the URA workbooks

## Safe preview

The default command is read-only. It does not require PostgreSQL and never modifies either workbook.

```powershell
npm run import:workbooks -- --admin "C:\path\URA_Provider_Availability_Tracker_ADMIN_MASTER.xlsx" --user "C:\path\URA_Provider_Availability_Tracker_USER_ACTIVE.xlsx" --output work\import-summary.json
```

The JSON contains file hashes, sheet names, aggregate counts, issue counts, and one redacted sample per issue code. It omits local paths and all raw row content.

## Database apply

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Start PostGIS: `docker compose up -d postgres`.
3. Run `npm run db:migrate`.
4. Run `npm run db:seed`.
5. Rerun the preview command with `--apply`.

Every workbook is keyed by SHA-256 plus importer version. A completed batch is a no-op on rerun. Calls also have a source-independent fingerprint, so the same call present in both workbooks is inserted once.

## Source precedence

1. Admin weekly call log
2. Admin facility and mapping masters
3. User weekly call log
4. Admin monthly archive
5. User facility and mapping copies

Lower-priority facility rows may fill a missing phone, ZIP, or coordinate, but do not rename an admin canonical record.

## Row handling

- rows are mapped by normalized header name, not column number
- empty formula scaffolding is skipped
- missing facility/timestamp call rows are rejected into staging
- malformed ZIP rows are rejected into staging
- valid calls with a facility absent from both masters are imported unlinked and flagged
- workbook output phrases are preserved in source metadata only; canonical results are recalculated
- raw staged data is sensitive and belongs inside database access controls

## Intake limits

Defaults are configurable in the environment:

- compressed workbook: 100 MB
- expanded ZIP content: 512 MB
- rows per source sheet: 100,000
- accepted containers: XLSX or XLSM

Encrypted archives, unsafe ZIP paths, missing workbook metadata, and missing required source sheets fail before any database write.
