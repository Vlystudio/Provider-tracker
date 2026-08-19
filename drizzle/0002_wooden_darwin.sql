ALTER TABLE "users" ALTER COLUMN "display_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;