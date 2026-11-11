CREATE TABLE "plumbing_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"prices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"labor_hours" numeric(12, 2) NOT NULL,
	"material_minor" bigint DEFAULT 0 NOT NULL,
	"unpriced_line_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "plumbing_estimates_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "plumbing_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"page_number" integer DEFAULT 1 NOT NULL,
	"reference_feet" numeric(12, 3) NOT NULL,
	"measured_pixels" integer NOT NULL,
	"feet_per_pixel" numeric(16, 8) NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "plumbing_plan_versions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "plumbing_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"jurisdiction" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "plumbing_projects_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "plumbing_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"fixtures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"runs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "plumbing_revisions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "plumbing_estimates" ADD CONSTRAINT "plumbing_estimates_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumbing_estimates" ADD CONSTRAINT "plumbing_estimates_project_id_fk" FOREIGN KEY ("org_id","project_id") REFERENCES "public"."plumbing_projects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumbing_estimates" ADD CONSTRAINT "plumbing_estimates_revision_id_fk" FOREIGN KEY ("org_id","revision_id") REFERENCES "public"."plumbing_revisions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumbing_plan_versions" ADD CONSTRAINT "plumbing_plan_versions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumbing_plan_versions" ADD CONSTRAINT "plumbing_plan_versions_project_id_fk" FOREIGN KEY ("org_id","project_id") REFERENCES "public"."plumbing_projects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumbing_projects" ADD CONSTRAINT "plumbing_projects_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumbing_revisions" ADD CONSTRAINT "plumbing_revisions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumbing_revisions" ADD CONSTRAINT "plumbing_revisions_project_id_fk" FOREIGN KEY ("org_id","project_id") REFERENCES "public"."plumbing_projects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plumbing_estimates_org_id_idx" ON "plumbing_estimates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "plumbing_estimates_org_id_project_id_idx" ON "plumbing_estimates" USING btree ("org_id","project_id");--> statement-breakpoint
CREATE INDEX "plumbing_estimates_org_id_status_idx" ON "plumbing_estimates" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "plumbing_plan_versions_org_id_idx" ON "plumbing_plan_versions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "plumbing_plan_versions_org_id_project_id_idx" ON "plumbing_plan_versions" USING btree ("org_id","project_id");--> statement-breakpoint
CREATE INDEX "plumbing_projects_org_id_idx" ON "plumbing_projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "plumbing_projects_org_id_status_idx" ON "plumbing_projects" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "plumbing_revisions_org_id_idx" ON "plumbing_revisions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plumbing_revisions_org_id_project_id_revision_number_uq" ON "plumbing_revisions" USING btree ("org_id","project_id","revision_number");--> statement-breakpoint
CREATE INDEX "plumbing_revisions_org_id_project_id_idx" ON "plumbing_revisions" USING btree ("org_id","project_id");-- ---------------------------------------------------------------------------------------------
-- Custom section (like 0002/0003): Row-Level Security for Plumbing Pro records. All four tables are
-- single-tenant records; every read and write runs under the caller's org via tenantTx, and RLS makes
-- another company's plans, designs and prices unreachable even if an id leaks.
SELECT fieldline_enable_tenant_rls('plumbing_projects');--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('plumbing_plan_versions');--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('plumbing_revisions');--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('plumbing_estimates');
