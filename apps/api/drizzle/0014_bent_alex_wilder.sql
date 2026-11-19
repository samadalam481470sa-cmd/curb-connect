ALTER TYPE "public"."consent_kind" ADD VALUE 'imagery_analysis' BEFORE 'portal_terms';--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD COLUMN "consent_id" uuid;--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD CONSTRAINT "imagery_assets_consent_id_fk" FOREIGN KEY ("org_id","consent_id") REFERENCES "public"."consents"("org_id","id") ON DELETE restrict ON UPDATE no action;