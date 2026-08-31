-- Remove sensitive legacy identifiers from staged workbook data before dropping
-- the structured columns. Header matching is case- and punctuation-insensitive.
UPDATE "import_row_results"
SET
	"raw_data" = COALESCE((
		SELECT jsonb_object_agg(entry.key, entry.value)
		FROM jsonb_each("import_row_results"."raw_data") AS entry
		WHERE regexp_replace(lower(entry.key), '[^a-z0-9]', '', 'g')
			NOT IN ('auth', 'authno', 'authnum', 'authnumber', 'authorization', 'authorizationno', 'authorizationnum', 'authorizationnumber')
	), '{}'::jsonb),
	"normalized_data" = "normalized_data" - 'authorizationNumber';--> statement-breakpoint

UPDATE "import_row_results"
SET "fingerprint" = 'tracking-redacted-' || "id"::text
WHERE "entity_type" = 'call';--> statement-breakpoint

-- Existing import fingerprints were derived partly from the removed value.
-- Replace them with non-identifying record IDs and remove the related logical hash.
UPDATE "calls"
SET
	"import_fingerprint" = CASE
		WHEN "import_fingerprint" IS NULL THEN NULL
		ELSE 'tracking-redacted-' || "id"::text
	END,
	"source_metadata" = "source_metadata" - 'logicalFingerprint'
WHERE "import_fingerprint" IS NOT NULL OR "source_metadata" ? 'logicalFingerprint';--> statement-breakpoint

DROP INDEX "authorizations_number_unique";--> statement-breakpoint
ALTER TABLE "authorizations" DROP COLUMN "authorization_number";--> statement-breakpoint
ALTER TABLE "calls" DROP COLUMN "authorization_number_snapshot";
