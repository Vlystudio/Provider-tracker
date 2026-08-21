CREATE TYPE "public"."assignment_status" AS ENUM('open', 'completed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."contact_outcome" AS ENUM('verified', 'no_answer', 'voicemail_left', 'voicemail_not_left', 'disconnected', 'wrong_number', 'fax_only', 'callback_requested', 'unable_to_verify');--> statement-breakpoint
CREATE TYPE "public"."coordinate_quality" AS ENUM('exact', 'address', 'zip_centroid', 'manual', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."duplicate_confidence" AS ENUM('exact', 'probable', 'possible');--> statement-breakpoint
CREATE TYPE "public"."duplicate_decision" AS ENUM('pending', 'not_duplicate', 'deferred', 'merged');--> statement-breakpoint
CREATE TYPE "public"."source_confidence" AS ENUM('direct', 'authoritative', 'secondary', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."verification_answer" AS ENUM('yes', 'no', 'unknown', 'not_asked', 'unable_to_verify', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('phone', 'fax', 'portal', 'website', 'email', 'internal_source', 'other');--> statement-breakpoint
CREATE TABLE "facility_contact_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"attempted_by" uuid,
	"method" "verification_method" NOT NULL,
	"outcome" "contact_outcome" NOT NULL,
	"contact_person" text,
	"contact_channel" text,
	"comments" text,
	"related_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_diagnosis_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"diagnosis_id" uuid NOT NULL,
	"status" "verification_answer" DEFAULT 'unknown' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"last_verified_at" timestamp with time zone,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"optimistic_lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_duplicate_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"left_facility_id" uuid NOT NULL,
	"right_facility_id" uuid NOT NULL,
	"confidence" "duplicate_confidence" NOT NULL,
	"score" integer NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" "duplicate_decision" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facility_duplicate_order_check" CHECK ("facility_duplicate_candidates"."left_facility_id" < "facility_duplicate_candidates"."right_facility_id"),
	CONSTRAINT "facility_duplicate_score_check" CHECK ("facility_duplicate_candidates"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "facility_merge_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survivor_facility_id" uuid NOT NULL,
	"merged_facility_id" uuid NOT NULL,
	"candidate_id" uuid,
	"merged_by" uuid,
	"reason" text NOT NULL,
	"restore_snapshot" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"undo_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facility_merge_distinct_check" CHECK ("facility_merge_records"."survivor_facility_id" <> "facility_merge_records"."merged_facility_id")
);
--> statement-breakpoint
CREATE TABLE "facility_verification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"verified_by" uuid,
	"method" "verification_method" NOT NULL,
	"confidence" "source_confidence" DEFAULT 'direct' NOT NULL,
	"contact_person" text,
	"contact_channel" text,
	"accepting_status" "verification_answer",
	"specialty_id" uuid,
	"specialty_status" "verification_answer",
	"diagnosis_id" uuid,
	"diagnosis_status" "verification_answer",
	"scheduling_within_four_weeks" "verification_answer",
	"urgent_referral_status" "verification_answer",
	"next_available_date" date,
	"estimated_wait_days" integer,
	"comments" text,
	"related_call_id" uuid,
	"related_contact_attempt_id" uuid,
	"import_batch_id" uuid,
	"previous_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resulting_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facility_verification_wait_days_check" CHECK ("facility_verification_events"."estimated_wait_days" is null or "facility_verification_events"."estimated_wait_days" >= 0),
	CONSTRAINT "facility_verification_has_fact_check" CHECK ("facility_verification_events"."accepting_status" is not null or "facility_verification_events"."specialty_status" is not null or "facility_verification_events"."diagnosis_status" is not null or "facility_verification_events"."scheduling_within_four_weeks" is not null or "facility_verification_events"."urgent_referral_status" is not null or "facility_verification_events"."next_available_date" is not null or "facility_verification_events"."estimated_wait_days" is not null or nullif(trim("facility_verification_events"."comments"), '') is not null)
);
--> statement-breakpoint
CREATE TABLE "reverification_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"assigned_to" uuid,
	"assigned_by" uuid,
	"status" "assignment_status" DEFAULT 'open' NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "address_line_1" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "address_line_2" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "state_code" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "coordinate_quality" "coordinate_quality" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "current_accepting_status" "verification_answer" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "current_scheduling_status" "verification_answer" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "current_urgent_referral_status" "verification_answer" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "next_available_date" date;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "estimated_wait_days" integer;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "accepting_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "scheduling_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "address_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "merged_into_facility_id" uuid;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "facility_specialties" ADD COLUMN "verification_status" "verification_answer" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_specialties" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_specialties" ADD COLUMN "optimistic_lock_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_contact_attempts" ADD CONSTRAINT "facility_contact_attempts_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_contact_attempts" ADD CONSTRAINT "facility_contact_attempts_attempted_by_users_id_fk" FOREIGN KEY ("attempted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_contact_attempts" ADD CONSTRAINT "facility_contact_attempts_related_call_id_calls_id_fk" FOREIGN KEY ("related_call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_diagnosis_capabilities" ADD CONSTRAINT "facility_diagnosis_capabilities_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_diagnosis_capabilities" ADD CONSTRAINT "facility_diagnosis_capabilities_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_duplicate_candidates" ADD CONSTRAINT "facility_duplicate_candidates_left_facility_id_facilities_id_fk" FOREIGN KEY ("left_facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_duplicate_candidates" ADD CONSTRAINT "facility_duplicate_candidates_right_facility_id_facilities_id_fk" FOREIGN KEY ("right_facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_duplicate_candidates" ADD CONSTRAINT "facility_duplicate_candidates_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_merge_records" ADD CONSTRAINT "facility_merge_records_survivor_facility_id_facilities_id_fk" FOREIGN KEY ("survivor_facility_id") REFERENCES "public"."facilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_merge_records" ADD CONSTRAINT "facility_merge_records_merged_facility_id_facilities_id_fk" FOREIGN KEY ("merged_facility_id") REFERENCES "public"."facilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_merge_records" ADD CONSTRAINT "facility_merge_records_candidate_id_facility_duplicate_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."facility_duplicate_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_merge_records" ADD CONSTRAINT "facility_merge_records_merged_by_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_merge_records" ADD CONSTRAINT "facility_merge_records_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_verification_events" ADD CONSTRAINT "facility_verification_events_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_verification_events" ADD CONSTRAINT "facility_verification_events_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_verification_events" ADD CONSTRAINT "facility_verification_events_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_verification_events" ADD CONSTRAINT "facility_verification_events_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_verification_events" ADD CONSTRAINT "facility_verification_events_related_call_id_calls_id_fk" FOREIGN KEY ("related_call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_verification_events" ADD CONSTRAINT "facility_verification_events_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverification_assignments" ADD CONSTRAINT "reverification_assignments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverification_assignments" ADD CONSTRAINT "reverification_assignments_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverification_assignments" ADD CONSTRAINT "reverification_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverification_assignments" ADD CONSTRAINT "reverification_assignments_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facility_contact_history_idx" ON "facility_contact_attempts" USING btree ("facility_id","attempted_at");--> statement-breakpoint
CREATE INDEX "facility_contact_outcome_idx" ON "facility_contact_attempts" USING btree ("outcome","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_diagnosis_unique_pair" ON "facility_diagnosis_capabilities" USING btree ("facility_id","diagnosis_id");--> statement-breakpoint
CREATE INDEX "facility_diagnosis_search_idx" ON "facility_diagnosis_capabilities" USING btree ("diagnosis_id","active","status");--> statement-breakpoint
CREATE INDEX "facility_diagnosis_freshness_idx" ON "facility_diagnosis_capabilities" USING btree ("facility_id","last_verified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_duplicate_pair_unique" ON "facility_duplicate_candidates" USING btree ("left_facility_id","right_facility_id");--> statement-breakpoint
CREATE INDEX "facility_duplicate_review_idx" ON "facility_duplicate_candidates" USING btree ("decision","confidence","score");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_merge_one_active_source" ON "facility_merge_records" USING btree ("merged_facility_id") WHERE "facility_merge_records"."undone_at" is null;--> statement-breakpoint
CREATE INDEX "facility_merge_survivor_idx" ON "facility_merge_records" USING btree ("survivor_facility_id","created_at");--> statement-breakpoint
CREATE INDEX "facility_verification_history_idx" ON "facility_verification_events" USING btree ("facility_id","verified_at");--> statement-breakpoint
CREATE INDEX "facility_verification_user_idx" ON "facility_verification_events" USING btree ("verified_by","verified_at");--> statement-breakpoint
CREATE INDEX "facility_verification_specialty_idx" ON "facility_verification_events" USING btree ("specialty_id","verified_at");--> statement-breakpoint
CREATE INDEX "facility_verification_diagnosis_idx" ON "facility_verification_events" USING btree ("diagnosis_id","verified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reverification_assignments_one_open" ON "reverification_assignments" USING btree ("facility_id") WHERE "reverification_assignments"."status" = 'open';--> statement-breakpoint
CREATE INDEX "reverification_assignments_assignee_idx" ON "reverification_assignments" USING btree ("assigned_to","status","created_at");--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facilities_verification_queue_idx" ON "facilities" USING btree ("active","last_verified_at");--> statement-breakpoint
CREATE INDEX "facilities_accepting_freshness_idx" ON "facilities" USING btree ("current_accepting_status","accepting_verified_at");--> statement-breakpoint
CREATE INDEX "facilities_merged_into_idx" ON "facilities" USING btree ("merged_into_facility_id");--> statement-breakpoint
CREATE INDEX "facilities_geography_gist" ON "facilities" USING gist (("geog_point"::geography));--> statement-breakpoint
CREATE INDEX "facility_specialties_search_idx" ON "facility_specialties" USING btree ("specialty_id","active","verification_status");--> statement-breakpoint
CREATE INDEX "facility_specialties_freshness_idx" ON "facility_specialties" USING btree ("facility_id","last_confirmed_at");--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_wait_days_check" CHECK ("facilities"."estimated_wait_days" is null or "facilities"."estimated_wait_days" >= 0);--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_merge_self_check" CHECK ("facilities"."merged_into_facility_id" is null or "facilities"."merged_into_facility_id" <> "facilities"."id");
--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_merged_into_facility_id_fk" FOREIGN KEY ("merged_into_facility_id") REFERENCES "public"."facilities"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "facility_verification_events" ADD CONSTRAINT "facility_verification_events_related_contact_attempt_id_fk" FOREIGN KEY ("related_contact_attempt_id") REFERENCES "public"."facility_contact_attempts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "facilities"
SET "coordinate_quality" = CASE
  WHEN "coordinate_provenance" = 'zip_centroid' THEN 'zip_centroid'::"coordinate_quality"
  WHEN "coordinate_provenance" = 'workbook_explicit' THEN 'manual'::"coordinate_quality"
  WHEN "geog_point" IS NOT NULL THEN 'unknown'::"coordinate_quality"
  ELSE 'unknown'::"coordinate_quality"
END;
--> statement-breakpoint
INSERT INTO "facility_contact_attempts" (
  "facility_id", "attempted_at", "attempted_by", "method", "outcome", "related_call_id"
)
SELECT
  "facility_id",
  "call_at",
  "caller_user_id",
  'phone'::"verification_method",
  CASE WHEN "did_not_leave_vm" THEN 'voicemail_not_left'::"contact_outcome" ELSE 'no_answer'::"contact_outcome" END,
  "id"
FROM "calls"
WHERE "facility_id" IS NOT NULL AND "result_code" = 'unable_to_contact';
--> statement-breakpoint
INSERT INTO "facility_verification_events" (
  "facility_id",
  "verified_at",
  "verified_by",
  "method",
  "confidence",
  "accepting_status",
  "specialty_id",
  "specialty_status",
  "diagnosis_id",
  "diagnosis_status",
  "scheduling_within_four_weeks",
  "urgent_referral_status",
  "related_call_id",
  "import_batch_id",
  "source_metadata"
)
SELECT
  c."facility_id",
  c."call_at",
  c."caller_user_id",
  'internal_source'::"verification_method",
  'secondary'::"source_confidence",
  CASE c."accepting_new_patients"::text
    WHEN 'yes' THEN 'yes'::"verification_answer"
    WHEN 'no' THEN 'no'::"verification_answer"
    WHEN 'not_applicable' THEN 'not_applicable'::"verification_answer"
    ELSE 'unknown'::"verification_answer"
  END,
  s."id",
  CASE c."specialty_confirmed"::text
    WHEN 'yes' THEN 'yes'::"verification_answer"
    WHEN 'no' THEN 'no'::"verification_answer"
    WHEN 'not_applicable' THEN 'not_applicable'::"verification_answer"
    ELSE 'unknown'::"verification_answer"
  END,
  d."id",
  CASE c."can_treat_diagnosis"::text
    WHEN 'yes' THEN 'yes'::"verification_answer"
    WHEN 'no' THEN 'no'::"verification_answer"
    WHEN 'not_applicable' THEN 'not_applicable'::"verification_answer"
    WHEN 'unable_to_tell_without_triage' THEN 'unable_to_verify'::"verification_answer"
    ELSE 'unknown'::"verification_answer"
  END,
  CASE c."can_schedule_within_four_weeks"::text
    WHEN 'yes' THEN 'yes'::"verification_answer"
    WHEN 'urgent_referral_required' THEN 'yes'::"verification_answer"
    WHEN 'no' THEN 'no'::"verification_answer"
    WHEN 'not_applicable' THEN 'not_applicable'::"verification_answer"
    WHEN 'unable_to_tell_without_triage' THEN 'unable_to_verify'::"verification_answer"
    ELSE 'unknown'::"verification_answer"
  END,
  CASE WHEN c."can_schedule_within_four_weeks" = 'urgent_referral_required' THEN 'yes'::"verification_answer" ELSE NULL END,
  c."id",
  c."import_batch_id",
  jsonb_build_object('origin', 'phase4_call_backfill', 'sourceWorkbook', c."source_workbook", 'sourceSheet', c."source_sheet", 'sourceRow', c."source_row")
FROM "calls" c
LEFT JOIN "diagnoses" d ON d."code" = c."diagnosis_code_snapshot"
LEFT JOIN "specialties" s ON lower(trim(s."canonical_name")) = lower(trim(c."specialty_snapshot"))
WHERE c."facility_id" IS NOT NULL AND c."result_code" <> 'unable_to_contact';
--> statement-breakpoint
WITH latest AS (
  SELECT DISTINCT ON ("facility_id") "facility_id", "verified_at"
  FROM "facility_verification_events"
  ORDER BY "facility_id", "verified_at" DESC, "created_at" DESC
)
UPDATE "facilities" f SET "last_verified_at" = latest."verified_at"
FROM latest WHERE f."id" = latest."facility_id";
--> statement-breakpoint
WITH latest AS (
  SELECT DISTINCT ON ("facility_id") "facility_id", "verified_at", "accepting_status"
  FROM "facility_verification_events"
  WHERE "accepting_status" IN ('yes', 'no', 'not_applicable')
  ORDER BY "facility_id", "verified_at" DESC, "created_at" DESC
)
UPDATE "facilities" f
SET "current_accepting_status" = latest."accepting_status", "accepting_verified_at" = latest."verified_at"
FROM latest WHERE f."id" = latest."facility_id";
--> statement-breakpoint
WITH latest AS (
  SELECT DISTINCT ON ("facility_id")
    "facility_id", "verified_at", "scheduling_within_four_weeks", "urgent_referral_status"
  FROM "facility_verification_events"
  WHERE "scheduling_within_four_weeks" IN ('yes', 'no', 'not_applicable', 'unable_to_verify')
     OR "urgent_referral_status" IS NOT NULL
  ORDER BY "facility_id", "verified_at" DESC, "created_at" DESC
)
UPDATE "facilities" f
SET
  "current_scheduling_status" = COALESCE(latest."scheduling_within_four_weeks", f."current_scheduling_status"),
  "current_urgent_referral_status" = COALESCE(latest."urgent_referral_status", f."current_urgent_referral_status"),
  "scheduling_verified_at" = latest."verified_at"
FROM latest WHERE f."id" = latest."facility_id";
--> statement-breakpoint
INSERT INTO "facility_diagnosis_capabilities" ("facility_id", "diagnosis_id", "status", "last_verified_at", "source_metadata")
SELECT DISTINCT ON (v."facility_id", v."diagnosis_id")
  v."facility_id", v."diagnosis_id", v."diagnosis_status", v."verified_at", jsonb_build_object('origin', 'phase4_call_backfill')
FROM "facility_verification_events" v
WHERE v."diagnosis_id" IS NOT NULL AND v."diagnosis_status" IS NOT NULL
ORDER BY v."facility_id", v."diagnosis_id", v."verified_at" DESC, v."created_at" DESC
ON CONFLICT ("facility_id", "diagnosis_id") DO NOTHING;
--> statement-breakpoint
WITH latest AS (
  SELECT DISTINCT ON (v."facility_id", v."specialty_id")
    v."facility_id", v."specialty_id", v."specialty_status", v."verified_at", v."related_call_id"
  FROM "facility_verification_events" v
  WHERE v."specialty_id" IS NOT NULL AND v."specialty_status" IS NOT NULL
  ORDER BY v."facility_id", v."specialty_id", v."verified_at" DESC, v."created_at" DESC
)
UPDATE "facility_specialties" fs
SET
  "verification_status" = latest."specialty_status",
  "last_confirmed_at" = latest."verified_at",
  "confirming_call_id" = latest."related_call_id",
  "updated_at" = now()
FROM latest
WHERE fs."facility_id" = latest."facility_id" AND fs."specialty_id" = latest."specialty_id";
