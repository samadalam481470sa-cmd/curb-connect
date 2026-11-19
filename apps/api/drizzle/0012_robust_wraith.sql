CREATE TABLE "roof_analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"property_id" uuid NOT NULL,
	"roof_order_id" uuid,
	"requested_by_user_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text DEFAULT 'google_solar' NOT NULL,
	"cache_key" text NOT NULL,
	"confirmed_address" text NOT NULL,
	"confirmed_latitude" double precision NOT NULL,
	"confirmed_longitude" double precision NOT NULL,
	"result" jsonb,
	"cached" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roof_analysis_jobs_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "roof_analysis_jobs" ADD CONSTRAINT "roof_analysis_jobs_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_analysis_jobs" ADD CONSTRAINT "roof_analysis_jobs_property_id_fk" FOREIGN KEY ("org_id","property_id") REFERENCES "public"."properties"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_analysis_jobs" ADD CONSTRAINT "roof_analysis_jobs_roof_order_id_fk" FOREIGN KEY ("org_id","roof_order_id") REFERENCES "public"."roof_orders"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roof_analysis_jobs_org_id_idx" ON "roof_analysis_jobs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "roof_analysis_jobs_org_id_status_idx" ON "roof_analysis_jobs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "roof_analysis_jobs_org_id_cache_key_finished_at_idx" ON "roof_analysis_jobs" USING btree ("org_id","cache_key","finished_at");--> statement-breakpoint
CREATE INDEX "roof_analysis_jobs_property_id_created_at_idx" ON "roof_analysis_jobs" USING btree ("property_id","created_at");--> statement-breakpoint
ALTER TABLE "roof_analysis_jobs" ADD CONSTRAINT "roof_analysis_jobs_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed'));--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('roof_analysis_jobs');--> statement-breakpoint
CREATE TRIGGER "a_touch_updated_at" BEFORE UPDATE ON "roof_analysis_jobs" FOR EACH ROW EXECUTE FUNCTION "fieldline_touch_updated_at"();