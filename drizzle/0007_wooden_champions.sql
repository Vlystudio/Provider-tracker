CREATE TYPE "public"."automation_result" AS ENUM('running', 'succeeded', 'failed', 'skipped', 'dry_run');--> statement-breakpoint
CREATE TYPE "public"."coverage_state" AS ENUM('unknown', 'healthy', 'alerting');--> statement-breakpoint
CREATE TYPE "public"."digest_frequency" AS ENUM('none', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('informational', 'attention', 'important');--> statement-breakpoint
CREATE TYPE "public"."work_item_status" AS ENUM('open', 'assigned', 'in_progress', 'completed', 'dismissed', 'blocked');--> statement-breakpoint
CREATE TABLE "automation_job_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_key" text NOT NULL,
	"job_type" text NOT NULL,
	"trigger" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"result" "automation_result" DEFAULT 'running' NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"release_version" text NOT NULL,
	"error_category" text,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_settings" (
	"scope" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"time_zone" text DEFAULT 'America/New_York' NOT NULL,
	"upcoming_stale_days" integer DEFAULT 7 NOT NULL,
	"meaningful_wait_increase_days" integer DEFAULT 14 NOT NULL,
	"meaningful_wait_increase_percent" integer DEFAULT 50 NOT NULL,
	"high_priority_escalation_days" integer DEFAULT 3 NOT NULL,
	"daily_digest_hour" integer DEFAULT 7 NOT NULL,
	"weekly_digest_day" integer DEFAULT 1 NOT NULL,
	"batch_size" integer DEFAULT 500 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_settings_scope_check" CHECK ("automation_settings"."scope" = 'global'),
	CONSTRAINT "automation_settings_upcoming_check" CHECK ("automation_settings"."upcoming_stale_days" between 0 and 30),
	CONSTRAINT "automation_settings_wait_days_check" CHECK ("automation_settings"."meaningful_wait_increase_days" between 1 and 180),
	CONSTRAINT "automation_settings_wait_percent_check" CHECK ("automation_settings"."meaningful_wait_increase_percent" between 1 and 500),
	CONSTRAINT "automation_settings_escalation_check" CHECK ("automation_settings"."high_priority_escalation_days" between 1 and 30),
	CONSTRAINT "automation_settings_daily_hour_check" CHECK ("automation_settings"."daily_digest_hour" between 0 and 23),
	CONSTRAINT "automation_settings_weekly_day_check" CHECK ("automation_settings"."weekly_digest_day" between 1 and 7),
	CONSTRAINT "automation_settings_batch_check" CHECK ("automation_settings"."batch_size" between 50 and 2000)
);
--> statement-breakpoint
CREATE TABLE "coverage_alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watch_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"state" text NOT NULL,
	"observed_count" integer NOT NULL,
	"threshold_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coverage_alert_state_check" CHECK ("coverage_alert_events"."state" in ('opened','resolved'))
);
--> statement-breakpoint
CREATE TABLE "coverage_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"specialty_id" uuid,
	"diagnosis_id" uuid,
	"postal_code" text NOT NULL,
	"radius_miles" integer NOT NULL,
	"minimum_count" integer NOT NULL,
	"freshness_days" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"state" "coverage_state" DEFAULT 'unknown' NOT NULL,
	"cycle" integer DEFAULT 0 NOT NULL,
	"last_count" integer,
	"last_evaluated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coverage_watches_radius_check" CHECK ("coverage_watches"."radius_miles" in (10,25,50,100)),
	CONSTRAINT "coverage_watches_minimum_check" CHECK ("coverage_watches"."minimum_count" between 1 and 100),
	CONSTRAINT "coverage_watches_freshness_check" CHECK ("coverage_watches"."freshness_days" between 1 and 365),
	CONSTRAINT "coverage_watches_filter_check" CHECK ("coverage_watches"."specialty_id" is not null or "coverage_watches"."diagnosis_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"digest_frequency" "digest_frequency" DEFAULT 'daily' NOT NULL,
	"categories" jsonb DEFAULT '["work","changes","coverage","digest"]'::jsonb NOT NULL,
	"minimum_severity" "notification_severity" DEFAULT 'informational' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"severity" "notification_severity" DEFAULT 'informational' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"target_path" text,
	"source" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"issue_key" text,
	"read_at" timestamp with time zone,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_target_path_check" CHECK ("notifications"."target_path" is null or "notifications"."target_path" like '/%')
);
--> statement-breakpoint
CREATE TABLE "operational_change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid,
	"event_type" text NOT NULL,
	"severity" "notification_severity" DEFAULT 'informational' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"deduplication_key" text NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"specialty_id" uuid,
	"diagnosis_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest_type" text NOT NULL,
	"audience_key" text NOT NULL,
	"recipient_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_version" text NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_digest_period_check" CHECK ("operational_digests"."period_start" < "operational_digests"."period_end")
);
--> statement-breakpoint
CREATE TABLE "operational_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_type" text NOT NULL,
	"priority" "notification_severity" DEFAULT 'attention' NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"due_at" timestamp with time zone,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "work_item_status" DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"assigned_by" uuid,
	"created_by" uuid,
	"source" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"blocked_reason" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" uuid,
	"dismissal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_work_cycle_check" CHECK ("operational_work_items"."cycle" >= 1)
);
--> statement-breakpoint
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_alert_events" ADD CONSTRAINT "coverage_alert_events_watch_id_coverage_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."coverage_watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_watches" ADD CONSTRAINT "coverage_watches_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_watches" ADD CONSTRAINT "coverage_watches_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_watches" ADD CONSTRAINT "coverage_watches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_change_events" ADD CONSTRAINT "operational_change_events_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_change_events" ADD CONSTRAINT "operational_change_events_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_change_events" ADD CONSTRAINT "operational_change_events_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_digests" ADD CONSTRAINT "operational_digests_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_digests" ADD CONSTRAINT "operational_digests_execution_id_automation_job_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."automation_job_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_work_items" ADD CONSTRAINT "operational_work_items_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_work_items" ADD CONSTRAINT "operational_work_items_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_work_items" ADD CONSTRAINT "operational_work_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_work_items" ADD CONSTRAINT "operational_work_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_work_items" ADD CONSTRAINT "operational_work_items_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_job_execution_key_unique" ON "automation_job_executions" USING btree ("execution_key");--> statement-breakpoint
CREATE INDEX "automation_job_type_started_idx" ON "automation_job_executions" USING btree ("job_type","started_at");--> statement-breakpoint
CREATE INDEX "automation_job_result_started_idx" ON "automation_job_executions" USING btree ("result","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coverage_alert_cycle_state_unique" ON "coverage_alert_events" USING btree ("watch_id","cycle","state");--> statement-breakpoint
CREATE INDEX "coverage_alert_watch_created_idx" ON "coverage_alert_events" USING btree ("watch_id","created_at");--> statement-breakpoint
CREATE INDEX "coverage_watches_enabled_idx" ON "coverage_watches" USING btree ("enabled","last_evaluated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_recipient_dedup_unique" ON "notifications" USING btree ("recipient_id","deduplication_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_read_idx" ON "notifications" USING btree ("recipient_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_change_dedup_unique" ON "operational_change_events" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "operational_change_occurred_idx" ON "operational_change_events" USING btree ("occurred_at","event_type");--> statement-breakpoint
CREATE INDEX "operational_change_facility_idx" ON "operational_change_events" USING btree ("facility_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_digest_period_unique" ON "operational_digests" USING btree ("digest_type","audience_key","period_start","period_end");--> statement-breakpoint
CREATE INDEX "operational_digest_recipient_idx" ON "operational_digests" USING btree ("recipient_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_work_dedup_unique" ON "operational_work_items" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "operational_work_assignee_status_idx" ON "operational_work_items" USING btree ("assigned_to","status","due_at");--> statement-breakpoint
CREATE INDEX "operational_work_type_status_idx" ON "operational_work_items" USING btree ("work_type","status","due_at");