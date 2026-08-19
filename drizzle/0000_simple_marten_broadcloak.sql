CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."authorization_status" AS ENUM('open', 'complete', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."availability_status" AS ENUM('yes', 'no', 'unknown', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."data_quality_status" AS ENUM('clean', 'needs_review', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('pending', 'staged', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_entity_type" AS ENUM('facility', 'facility_specialty', 'call', 'authorization', 'diagnosis', 'specialty', 'line_of_business', 'postal_code');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('staged', 'imported', 'skipped', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."report_snapshot_type" AS ENUM('weekly', 'monthly', 'all_time', 'scheduling_trend');--> statement-breakpoint
CREATE TYPE "public"."result_code" AS ENUM('unable_to_contact', 'does_not_meet_availability_guidelines', 'meets_availability_guidelines', 'meets_availability_guidelines_urgent');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('yes', 'no', 'unknown', 'urgent_referral_required', 'unable_to_tell_without_triage', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."treatment_status" AS ENUM('yes', 'no', 'unknown', 'unable_to_tell_without_triage', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'ura_user', 'report_viewer', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."workbook_kind" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"request_id" text,
	"source_ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authorization_number" text NOT NULL,
	"lob_id" uuid,
	"default_diagnosis_id" uuid,
	"default_specialty_id" uuid,
	"referral_reason_id" uuid,
	"referral_reason_detail" text,
	"member_zip" text,
	"created_by" uuid,
	"status" "authorization_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_out_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"lower_bound_days" integer,
	"upper_bound_days" integer,
	"rank" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_out_buckets_bounds_check" CHECK ("booking_out_buckets"."lower_bound_days" is null or "booking_out_buckets"."upper_bound_days" is null or "booking_out_buckets"."lower_bound_days" <= "booking_out_buckets"."upper_bound_days")
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authorization_id" uuid,
	"facility_id" uuid,
	"caller_user_id" uuid,
	"import_batch_id" uuid,
	"call_at" timestamp with time zone NOT NULL,
	"caller_initials_snapshot" text,
	"lob_snapshot" text,
	"authorization_number_snapshot" text,
	"facility_snapshot" text NOT NULL,
	"diagnosis_code_snapshot" text,
	"diagnosis_description_snapshot" text,
	"specialty_snapshot" text,
	"phone_snapshot" text,
	"did_not_leave_vm" boolean DEFAULT false NOT NULL,
	"accepting_new_patients" "availability_status" DEFAULT 'unknown' NOT NULL,
	"can_treat_diagnosis" "treatment_status" DEFAULT 'unknown' NOT NULL,
	"can_schedule_within_four_weeks" "schedule_status" DEFAULT 'unknown' NOT NULL,
	"booking_out_raw" text,
	"booking_out_bucket_id" uuid,
	"notes" text,
	"referral_type_snapshot" text,
	"referral_reason_snapshot" text,
	"specialty_confirmed" "availability_status" DEFAULT 'unknown' NOT NULL,
	"use_in_fdm" boolean DEFAULT false NOT NULL,
	"manual_call_time_override" timestamp with time zone,
	"week_start" date,
	"duplicate_group_key" text,
	"repeat_call_reason" text,
	"result_code" "result_code" NOT NULL,
	"result_phrase" text NOT NULL,
	"rule_version" text DEFAULT 'v1' NOT NULL,
	"import_fingerprint" text,
	"source_workbook" text,
	"source_sheet" text,
	"source_row" integer,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"optimistic_lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_name" text NOT NULL,
	"city" text NOT NULL,
	"normalized_name" text NOT NULL,
	"normalized_city" text NOT NULL,
	"display_key" text NOT NULL,
	"facility_type" text DEFAULT 'Hospital' NOT NULL,
	"auto_fill_specialty" boolean DEFAULT false NOT NULL,
	"phone_raw" text,
	"phone_normalized" text,
	"postal_code" text,
	"latitude" double precision,
	"longitude" double precision,
	"geog_point" geometry(point),
	"coordinate_provenance" text,
	"active" boolean DEFAULT true NOT NULL,
	"data_quality_status" "data_quality_status" DEFAULT 'clean' NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"optimistic_lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facilities_coordinate_pair_check" CHECK (("facilities"."latitude" is null and "facilities"."longitude" is null) or ("facilities"."latitude" is not null and "facilities"."longitude" is not null))
);
--> statement-breakpoint
CREATE TABLE "facility_specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"specialty_id" uuid NOT NULL,
	"treatment_status" "treatment_status" DEFAULT 'unknown' NOT NULL,
	"notes" text,
	"last_confirmed_at" timestamp with time zone,
	"confirming_call_id" uuid,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_file_name" text NOT NULL,
	"source_hash" text NOT NULL,
	"source_size_bytes" integer NOT NULL,
	"workbook_kind" "workbook_kind" NOT NULL,
	"importer_version" text NOT NULL,
	"status" "import_batch_status" DEFAULT 'pending' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_row_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"entity_type" "import_entity_type" NOT NULL,
	"sheet_name" text NOT NULL,
	"source_row" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"status" "import_row_status" DEFAULT 'staged' NOT NULL,
	"canonical_entity_id" uuid,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lines_of_business" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lines_of_business_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "postal_code_centroids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zip_code" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"geog_point" geometry(point),
	"source" text DEFAULT 'workbook' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postal_code_centroids_lat_check" CHECK ("postal_code_centroids"."latitude" between -90 and 90),
	CONSTRAINT "postal_code_centroids_lon_check" CHECK ("postal_code_centroids"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "referral_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"normalized_label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_type" "report_snapshot_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid,
	"rule_version" text DEFAULT 'v1' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_snapshots_period_check" CHECK ("report_snapshots"."period_start" <= "report_snapshots"."period_end")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"display_name" text NOT NULL,
	"image" text,
	"initials" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_service_account" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_lob_id_lines_of_business_id_fk" FOREIGN KEY ("lob_id") REFERENCES "public"."lines_of_business"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_default_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("default_diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_default_specialty_id_specialties_id_fk" FOREIGN KEY ("default_specialty_id") REFERENCES "public"."specialties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_referral_reason_id_referral_reasons_id_fk" FOREIGN KEY ("referral_reason_id") REFERENCES "public"."referral_reasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_authorization_id_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."authorizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_user_id_users_id_fk" FOREIGN KEY ("caller_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_booking_out_bucket_id_booking_out_buckets_id_fk" FOREIGN KEY ("booking_out_bucket_id") REFERENCES "public"."booking_out_buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_specialties" ADD CONSTRAINT "facility_specialties_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_specialties" ADD CONSTRAINT "facility_specialties_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_specialties" ADD CONSTRAINT "facility_specialties_confirming_call_id_calls_id_fk" FOREIGN KEY ("confirming_call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row_results" ADD CONSTRAINT "import_row_results_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_created_idx" ON "audit_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "authorizations_number_unique" ON "authorizations" USING btree ("authorization_number");--> statement-breakpoint
CREATE INDEX "authorizations_status_updated_idx" ON "authorizations" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_out_buckets_code_unique" ON "booking_out_buckets" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_import_fingerprint_unique" ON "calls" USING btree ("import_fingerprint");--> statement-breakpoint
CREATE INDEX "calls_call_at_idx" ON "calls" USING btree ("call_at");--> statement-breakpoint
CREATE INDEX "calls_facility_call_at_idx" ON "calls" USING btree ("facility_id","call_at");--> statement-breakpoint
CREATE INDEX "calls_authorization_call_at_idx" ON "calls" USING btree ("authorization_id","call_at");--> statement-breakpoint
CREATE INDEX "calls_fdm_latest_idx" ON "calls" USING btree ("facility_id","specialty_snapshot","diagnosis_code_snapshot","call_at");--> statement-breakpoint
CREATE INDEX "calls_weekly_duplicate_idx" ON "calls" USING btree ("facility_id","diagnosis_code_snapshot","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnoses_code_unique" ON "diagnoses" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_normalized_name_city_unique" ON "facilities" USING btree ("normalized_name","normalized_city");--> statement-breakpoint
CREATE INDEX "facilities_display_key_idx" ON "facilities" USING btree ("display_key");--> statement-breakpoint
CREATE INDEX "facilities_postal_code_idx" ON "facilities" USING btree ("postal_code");--> statement-breakpoint
CREATE INDEX "facilities_active_name_idx" ON "facilities" USING btree ("active","normalized_name");--> statement-breakpoint
CREATE INDEX "facilities_geog_gist" ON "facilities" USING gist ("geog_point");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_specialty_unique_pair" ON "facility_specialties" USING btree ("facility_id","specialty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_hash_version_unique" ON "import_batches" USING btree ("source_hash","importer_version");--> statement-breakpoint
CREATE INDEX "import_batches_status_created_idx" ON "import_batches" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_row_results_source_unique" ON "import_row_results" USING btree ("batch_id","entity_type","sheet_name","source_row");--> statement-breakpoint
CREATE INDEX "import_row_results_fingerprint_idx" ON "import_row_results" USING btree ("entity_type","fingerprint");--> statement-breakpoint
CREATE INDEX "import_row_results_status_idx" ON "import_row_results" USING btree ("batch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "postal_code_centroids_zip_unique" ON "postal_code_centroids" USING btree ("zip_code");--> statement-breakpoint
CREATE INDEX "postal_code_centroids_geog_gist" ON "postal_code_centroids" USING gist ("geog_point");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_reasons_normalized_label_unique" ON "referral_reasons" USING btree ("normalized_label");--> statement-breakpoint
CREATE UNIQUE INDEX "report_snapshots_period_unique" ON "report_snapshots" USING btree ("snapshot_type","period_start","period_end");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires");--> statement-breakpoint
CREATE UNIQUE INDEX "specialties_normalized_name_unique" ON "specialties" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_initials_unique" ON "users" USING btree ("initials");--> statement-breakpoint
CREATE INDEX "users_role_active_idx" ON "users" USING btree ("role","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_token_unique" ON "verification_tokens" USING btree ("token");
