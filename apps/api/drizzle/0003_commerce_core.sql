CREATE TABLE "approval_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"subject_type" "approval_subject_type" NOT NULL,
	"product_line" "product_line",
	"jurisdiction_id" uuid,
	"required_signoffs" "signoff_role"[] NOT NULL,
	"separation_of_duties" boolean DEFAULT true NOT NULL,
	"min_amount_minor" bigint,
	"eligible_roles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "approval_policies_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"command_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"status" text NOT NULL,
	"expected_revision" integer NOT NULL,
	"server_revision" integer NOT NULL,
	"request_hash" text NOT NULL,
	"response_body" jsonb NOT NULL,
	"actor_user_id" uuid,
	"correlation_id" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_receipts_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "estimate_revisions" ALTER COLUMN "subtotal_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ALTER COLUMN "tax_minor" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ALTER COLUMN "tax_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ALTER COLUMN "total_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ALTER COLUMN "low_total_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ALTER COLUMN "high_total_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "geocoder_attribution" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "geocode_precision" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "geocode_storable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "jurisdiction_status" text DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "jurisdiction_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "jurisdiction_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "jurisdiction_selected_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "scope_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "scope_confirmed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "structures" ADD COLUMN "candidate_source" text DEFAULT 'user_added' NOT NULL;--> statement-breakpoint
ALTER TABLE "structures" ADD COLUMN "detection_confidence" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "structures" ADD COLUMN "scope_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "price_book_revisions" ADD COLUMN "max_price_age_days" integer DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE "price_book_revisions" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "price_books" ADD COLUMN "service_area_id" uuid;--> statement-breakpoint
ALTER TABLE "price_items" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_items" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "price_items" ADD COLUMN "price_date" date;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ADD COLUMN "engine_versions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ADD COLUMN "input_hash" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ALTER COLUMN "input_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ADD COLUMN "line_specs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ADD COLUMN "site_conditions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ADD COLUMN "price_book_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ALTER COLUMN "price_book_snapshot" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "property_id" uuid;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "stale_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "acting_for_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_policies_org_id_idx" ON "approval_policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "approval_policies_org_id_subject_type_active_idx" ON "approval_policies" USING btree ("org_id","subject_type","active");--> statement-breakpoint
CREATE INDEX "command_receipts_org_id_idx" ON "command_receipts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "command_receipts_org_id_command_id_uq" ON "command_receipts" USING btree ("org_id","command_id");--> statement-breakpoint
CREATE INDEX "command_receipts_org_id_aggregate_id_idx" ON "command_receipts" USING btree ("org_id","aggregate_id");--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_service_area_id_fk" FOREIGN KEY ("org_id","service_area_id") REFERENCES "public"."service_areas"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_property_id_fk" FOREIGN KEY ("org_id","property_id") REFERENCES "public"."properties"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_jurisdiction_status_ck" CHECK ("properties"."jurisdiction_status" in ('resolved', 'ambiguous', 'unresolved', 'manual'));--> statement-breakpoint
-- ------------------------------------------------------------------ hand-written (commerce core)
-- New tenant tables: ENABLE + FORCE RLS with the standard tenant policy, updated_at maintenance.
SELECT fieldline_enable_tenant_rls('public.command_receipts');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.approval_policies');
--> statement-breakpoint
CREATE TRIGGER a_touch_updated_at BEFORE UPDATE ON public.command_receipts FOR EACH ROW EXECUTE FUNCTION fieldline_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER a_touch_updated_at BEFORE UPDATE ON public.approval_policies FOR EACH ROW EXECUTE FUNCTION fieldline_touch_updated_at();
--> statement-breakpoint
-- Receipts are evidence of what the server committed: insert-only.
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.command_receipts FOR EACH ROW EXECUTE FUNCTION fieldline_reject_mutation();
--> statement-breakpoint
-- CP-059 D: approval records are immutable. The only permitted change is a one-time withdrawal
-- (withdrawn_at + withdrawn_reason, plus updated_at); rows are never deleted.
CREATE OR REPLACE FUNCTION fieldline_guard_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approvals % is immutable', OLD.id USING ERRCODE = 'FL001';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL
     OR (to_jsonb(NEW) - 'withdrawn_at' - 'withdrawn_reason' - 'updated_at')
        IS DISTINCT FROM (to_jsonb(OLD) - 'withdrawn_at' - 'withdrawn_reason' - 'updated_at') THEN
    RAISE EXCEPTION 'approvals % is immutable (only a single withdrawal is allowed)', OLD.id USING ERRCODE = 'FL001';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER z_guard_approval BEFORE UPDATE OR DELETE ON public.approvals FOR EACH ROW EXECUTE FUNCTION fieldline_guard_approval();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.command_receipts, public.approval_policies TO fieldline_app, fieldline_platform;
