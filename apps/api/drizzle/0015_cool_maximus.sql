ALTER TYPE "public"."consent_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_supersedes_id_fk" FOREIGN KEY ("org_id","supersedes_id") REFERENCES "public"."consents"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_supersedes_id_idx" ON "consents" USING btree ("supersedes_id");