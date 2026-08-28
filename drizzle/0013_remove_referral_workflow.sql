ALTER TABLE "authorizations" DROP CONSTRAINT "authorizations_referral_reason_id_referral_reasons_id_fk";
--> statement-breakpoint
ALTER TABLE "authorizations" DROP COLUMN "referral_reason_id";--> statement-breakpoint
ALTER TABLE "authorizations" DROP COLUMN "referral_reason_detail";--> statement-breakpoint
ALTER TABLE "calls" DROP COLUMN "referral_type_snapshot";--> statement-breakpoint
ALTER TABLE "calls" DROP COLUMN "referral_reason_snapshot";--> statement-breakpoint
DROP TABLE "referral_reasons";
