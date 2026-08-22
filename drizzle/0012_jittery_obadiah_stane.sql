CREATE TYPE "public"."access_review_decision" AS ENUM('retain', 'modify', 'disable', 'investigate');--> statement-breakpoint
CREATE TABLE "access_review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_period" text NOT NULL,
	"reviewed_user_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"reviewed_role" "user_role" NOT NULL,
	"account_active" boolean NOT NULL,
	"last_signed_in_at" timestamp with time zone,
	"decision" "access_review_decision" NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_review_period_check" CHECK ("access_review_decisions"."review_period" ~ '^[0-9]{4}-Q[1-4]$')
);
--> statement-breakpoint
CREATE TABLE "data_retention_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"reason_code" text NOT NULL,
	"placed_by" uuid,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	CONSTRAINT "data_retention_hold_category_check" CHECK (char_length("data_retention_holds"."category") between 2 and 80 and "data_retention_holds"."category" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "data_retention_hold_reason_check" CHECK (char_length("data_retention_holds"."reason_code") between 2 and 80 and "data_retention_holds"."reason_code" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "data_retention_hold_entity_pair_check" CHECK (("data_retention_holds"."entity_type" is null and "data_retention_holds"."entity_id" is null) or ("data_retention_holds"."entity_type" is not null and "data_retention_holds"."entity_id" is not null)),
	CONSTRAINT "data_retention_hold_release_pair_check" CHECK (("data_retention_holds"."released_by" is null and "data_retention_holds"."released_at" is null) or ("data_retention_holds"."released_by" is not null and "data_retention_holds"."released_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "data_retention_policies" (
	"category" text PRIMARY KEY NOT NULL,
	"retention_days" integer,
	"deletion_enabled" boolean DEFAULT false NOT NULL,
	"policy_reference" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_retention_category_check" CHECK (char_length("data_retention_policies"."category") between 2 and 80 and "data_retention_policies"."category" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "data_retention_days_check" CHECK ("data_retention_policies"."retention_days" is null or "data_retention_policies"."retention_days" between 1 and 36500),
	CONSTRAINT "data_retention_policy_reference_check" CHECK ("data_retention_policies"."policy_reference" is null or char_length("data_retention_policies"."policy_reference") between 3 and 200),
	CONSTRAINT "data_retention_deletion_approval_check" CHECK (not "data_retention_policies"."deletion_enabled" or ("data_retention_policies"."retention_days" is not null and "data_retention_policies"."policy_reference" is not null and "data_retention_policies"."approved_by" is not null and "data_retention_policies"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_signed_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_review_decisions" ADD CONSTRAINT "access_review_decisions_reviewed_user_id_users_id_fk" FOREIGN KEY ("reviewed_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_review_decisions" ADD CONSTRAINT "access_review_decisions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_retention_holds" ADD CONSTRAINT "data_retention_holds_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_retention_holds" ADD CONSTRAINT "data_retention_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_review_period_user_reviewer_unique" ON "access_review_decisions" USING btree ("review_period","reviewed_user_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "access_review_user_decided_idx" ON "access_review_decisions" USING btree ("reviewed_user_id","decided_at");--> statement-breakpoint
CREATE INDEX "access_review_period_decided_idx" ON "access_review_decisions" USING btree ("review_period","decided_at");--> statement-breakpoint
CREATE INDEX "data_retention_hold_category_active_idx" ON "data_retention_holds" USING btree ("category","released_at");--> statement-breakpoint
CREATE INDEX "data_retention_hold_entity_idx" ON "data_retention_holds" USING btree ("entity_type","entity_id","released_at");--> statement-breakpoint
CREATE INDEX "users_last_signed_in_idx" ON "users" USING btree ("last_signed_in_at");