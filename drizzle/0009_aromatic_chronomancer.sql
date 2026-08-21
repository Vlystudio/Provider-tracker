CREATE TYPE "public"."legacy_actor_status" AS ENUM('unmapped', 'mapped', 'legacy_only', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."migration_diagnostic_status" AS ENUM('open', 'resolved', 'deferred', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."migration_readiness" AS ENUM('go', 'go_with_warnings', 'no_go');--> statement-breakpoint
CREATE TYPE "public"."migration_run_status" AS ENUM('previewed', 'approved', 'running', 'failed', 'applied', 'reconciled', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TABLE "legacy_actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_key" text NOT NULL,
	"initials" text,
	"display_name" text,
	"status" "legacy_actor_status" DEFAULT 'unmapped' NOT NULL,
	"mapped_user_id" uuid,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapped_by" uuid,
	"mapped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_value_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_type" text NOT NULL,
	"source_value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"target_entity_id" uuid,
	"decision" text DEFAULT 'mapped' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_value_mappings_type_check" CHECK ("legacy_value_mappings"."mapping_type" in ('specialty','diagnosis','actor')),
	CONSTRAINT "legacy_value_mappings_decision_check" CHECK ("legacy_value_mappings"."decision" in ('mapped','skip'))
);
--> statement-breakpoint
CREATE TABLE "migration_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"migration_run_id" uuid NOT NULL,
	"source_hash" text NOT NULL,
	"workbook_kind" "workbook_kind" NOT NULL,
	"entity_type" text NOT NULL,
	"sheet_name" text NOT NULL,
	"source_row" integer NOT NULL,
	"row_key" text,
	"issue_code" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"suggested_action" text,
	"status" "migration_diagnostic_status" DEFAULT 'open' NOT NULL,
	"resolution_action" text,
	"target_entity_id" uuid,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"optimistic_lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"migration_run_id" uuid NOT NULL,
	"source_rows" integer NOT NULL,
	"reconciled_rows" integer NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"updated_rows" integer DEFAULT 0 NOT NULL,
	"unchanged_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"conflict_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"reconciliation_percent" double precision NOT NULL,
	"relationship_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state_distribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"report_comparison" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discrepancies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"readiness" "migration_readiness" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_reconciliations_percent_check" CHECK ("migration_reconciliations"."reconciliation_percent" between 0 and 100),
	CONSTRAINT "migration_reconciliations_rows_check" CHECK ("migration_reconciliations"."reconciled_rows" <= "migration_reconciliations"."source_rows")
);
--> statement-breakpoint
CREATE TABLE "migration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"importer_version" text NOT NULL,
	"status" "migration_run_status" DEFAULT 'previewed' NOT NULL,
	"release_version" text NOT NULL,
	"source_manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"apply_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reconciliation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"readiness" "migration_readiness" DEFAULT 'no_go' NOT NULL,
	"notification_baseline_at" timestamp with time zone,
	"previewed_by" uuid,
	"approved_by" uuid,
	"executed_by" uuid,
	"reversed_by" uuid,
	"failure_category" text,
	"failure_message" text,
	"approval_reason" text,
	"reversal_reason" text,
	"approved_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"migration_run_id" uuid NOT NULL,
	"workbook_kind" "workbook_kind" NOT NULL,
	"source_file_name" text NOT NULL,
	"source_hash" text NOT NULL,
	"source_size_bytes" integer NOT NULL,
	"schema_version" text NOT NULL,
	"sheets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rows_scanned" integer DEFAULT 0 NOT NULL,
	"formula_cells" integer DEFAULT 0 NOT NULL,
	"hidden_rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "legacy_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "migration_baseline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facility_contact_attempts" ADD COLUMN "legacy_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "facility_verification_events" ADD COLUMN "legacy_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "migration_run_id" uuid;--> statement-breakpoint
ALTER TABLE "legacy_actors" ADD CONSTRAINT "legacy_actors_mapped_user_id_users_id_fk" FOREIGN KEY ("mapped_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_actors" ADD CONSTRAINT "legacy_actors_mapped_by_users_id_fk" FOREIGN KEY ("mapped_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_value_mappings" ADD CONSTRAINT "legacy_value_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_diagnostics" ADD CONSTRAINT "migration_diagnostics_migration_run_id_migration_runs_id_fk" FOREIGN KEY ("migration_run_id") REFERENCES "public"."migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_diagnostics" ADD CONSTRAINT "migration_diagnostics_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_reconciliations" ADD CONSTRAINT "migration_reconciliations_migration_run_id_migration_runs_id_fk" FOREIGN KEY ("migration_run_id") REFERENCES "public"."migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_previewed_by_users_id_fk" FOREIGN KEY ("previewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_sources" ADD CONSTRAINT "migration_sources_migration_run_id_migration_runs_id_fk" FOREIGN KEY ("migration_run_id") REFERENCES "public"."migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_actors_normalized_key_unique" ON "legacy_actors" USING btree ("normalized_key");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_value_mappings_type_value_unique" ON "legacy_value_mappings" USING btree ("mapping_type","normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_diagnostics_source_issue_unique" ON "migration_diagnostics" USING btree ("migration_run_id","source_hash","entity_type","sheet_name","source_row","issue_code");--> statement-breakpoint
CREATE INDEX "migration_diagnostics_run_status_idx" ON "migration_diagnostics" USING btree ("migration_run_id","status","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_reconciliations_run_unique" ON "migration_reconciliations" USING btree ("migration_run_id");--> statement-breakpoint
CREATE INDEX "migration_runs_status_created_idx" ON "migration_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "migration_runs_readiness_created_idx" ON "migration_runs" USING btree ("readiness","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_sources_run_hash_unique" ON "migration_sources" USING btree ("migration_run_id","source_hash");--> statement-breakpoint
CREATE INDEX "migration_sources_hash_idx" ON "migration_sources" USING btree ("source_hash");--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_legacy_actor_id_legacy_actors_id_fk" FOREIGN KEY ("legacy_actor_id") REFERENCES "public"."legacy_actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_contact_attempts" ADD CONSTRAINT "facility_contact_attempts_legacy_actor_id_legacy_actors_id_fk" FOREIGN KEY ("legacy_actor_id") REFERENCES "public"."legacy_actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_verification_events" ADD CONSTRAINT "facility_verification_events_legacy_actor_id_legacy_actors_id_fk" FOREIGN KEY ("legacy_actor_id") REFERENCES "public"."legacy_actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_migration_run_id_migration_runs_id_fk" FOREIGN KEY ("migration_run_id") REFERENCES "public"."migration_runs"("id") ON DELETE set null ON UPDATE no action;