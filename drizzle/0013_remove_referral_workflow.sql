ALTER TABLE IF EXISTS "authorizations" DROP CONSTRAINT IF EXISTS "authorizations_referral_reason_id_referral_reasons_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "authorizations" DROP COLUMN IF EXISTS "referral_reason_id";--> statement-breakpoint
ALTER TABLE IF EXISTS "authorizations" DROP COLUMN IF EXISTS "referral_reason_detail";--> statement-breakpoint
ALTER TABLE IF EXISTS "calls" DROP COLUMN IF EXISTS "referral_type_snapshot";--> statement-breakpoint
ALTER TABLE IF EXISTS "calls" DROP COLUMN IF EXISTS "referral_reason_snapshot";--> statement-breakpoint
DROP TABLE IF EXISTS "referral_reasons";
