DROP INDEX "accounts_provider_account_unique";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "issuer" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_issuer_account_unique" ON "accounts" USING btree ("issuer","account_id");