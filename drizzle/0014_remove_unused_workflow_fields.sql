ALTER TABLE "authorizations" DROP CONSTRAINT "authorizations_default_diagnosis_id_diagnoses_id_fk";--> statement-breakpoint
ALTER TABLE "authorizations" DROP CONSTRAINT "authorizations_default_specialty_id_specialties_id_fk";--> statement-breakpoint
ALTER TABLE "calls" DROP CONSTRAINT "calls_booking_out_bucket_id_booking_out_buckets_id_fk";--> statement-breakpoint
DROP INDEX "calls_fdm_latest_idx";--> statement-breakpoint
ALTER TABLE "authorizations" DROP COLUMN "default_diagnosis_id";--> statement-breakpoint
ALTER TABLE "authorizations" DROP COLUMN "default_specialty_id";--> statement-breakpoint
ALTER TABLE "calls" DROP COLUMN "booking_out_raw";--> statement-breakpoint
ALTER TABLE "calls" DROP COLUMN "booking_out_bucket_id";--> statement-breakpoint
ALTER TABLE "calls" DROP COLUMN "use_in_fdm";--> statement-breakpoint
ALTER TABLE "calls" DROP COLUMN "manual_call_time_override";--> statement-breakpoint
ALTER TABLE "calls" DROP COLUMN "repeat_call_reason";--> statement-breakpoint
DROP TABLE "booking_out_buckets";--> statement-breakpoint
ALTER TABLE "facility_contact_attempts" DROP COLUMN "contact_person";--> statement-breakpoint
ALTER TABLE "facility_contact_attempts" DROP COLUMN "contact_channel";--> statement-breakpoint
ALTER TABLE "facility_verification_events" DROP COLUMN "contact_person";--> statement-breakpoint
ALTER TABLE "facility_verification_events" DROP COLUMN "contact_channel";--> statement-breakpoint
ALTER TABLE "facility_verification_events" DROP COLUMN "related_contact_attempt_id";
