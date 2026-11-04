CREATE TYPE "public"."bill_status" AS ENUM('received', 'approved', 'disputed', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."connection_direction" AS ENUM('outgoing', 'incoming');--> statement-breakpoint
CREATE TYPE "public"."connection_scope" AS ENUM('invoices', 'projects', 'directory');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('pending', 'active', 'declined', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."network_invoice_status" AS ENUM('draft', 'sent', 'viewed', 'approved', 'disputed', 'resolved', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."network_project_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."payment_link_status" AS ENUM('open', 'paid', 'expired', 'canceled');--> statement-breakpoint
ALTER TYPE "public"."notification_category" ADD VALUE 'invoice_received' BEFORE 'invitation';--> statement-breakpoint
ALTER TYPE "public"."notification_category" ADD VALUE 'invoice_approved' BEFORE 'invitation';--> statement-breakpoint
ALTER TYPE "public"."notification_category" ADD VALUE 'invoice_disputed' BEFORE 'invitation';--> statement-breakpoint
ALTER TYPE "public"."notification_category" ADD VALUE 'invoice_paid' BEFORE 'invitation';--> statement-breakpoint
CREATE TABLE "company_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pair_key" uuid NOT NULL,
	"partner_org_id" uuid NOT NULL,
	"partner_display_name" text NOT NULL,
	"partner_slug" text NOT NULL,
	"direction" "connection_direction" NOT NULL,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"scopes" "connection_scope"[] DEFAULT '{invoices}' NOT NULL,
	"message" text,
	"requested_by_user_id" uuid,
	"responded_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "company_connections_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "network_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"issuer_org_id" uuid NOT NULL,
	"issuer_name" text NOT NULL,
	"issuer_slug" text NOT NULL,
	"project_name" text,
	"number" text NOT NULL,
	"status" "bill_status" DEFAULT 'received' NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"issued_on" date,
	"due_on" date,
	"memo" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dispute_reason" text,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"paid_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "network_bills_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "network_payment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bill_id" uuid NOT NULL,
	"provider_reference" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"provider" "payment_provider" DEFAULT 'stand_in' NOT NULL,
	"status" "payment_link_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "network_payment_links_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "network_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"network_key" uuid NOT NULL,
	"reference" text NOT NULL,
	"name" text NOT NULL,
	"client_name" text,
	"site_address" text,
	"status" "network_project_status" DEFAULT 'active' NOT NULL,
	"side" text NOT NULL,
	"partner_org_id" uuid NOT NULL,
	"partner_display_name" text NOT NULL,
	"connection_id" uuid,
	"contract_value_minor" bigint,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "network_projects_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "directory_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "service_area_label" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recipient_org_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recipient_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "delivery_status" "network_invoice_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "network_project_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "company_connections" ADD CONSTRAINT "company_connections_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_bills" ADD CONSTRAINT "network_bills_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_payment_links" ADD CONSTRAINT "network_payment_links_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_payment_links" ADD CONSTRAINT "network_payment_links_bill_id_fk" FOREIGN KEY ("org_id","bill_id") REFERENCES "public"."network_bills"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_projects" ADD CONSTRAINT "network_projects_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_connections_org_id_idx" ON "company_connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_connections_org_id_partner_org_id_uq" ON "company_connections" USING btree ("org_id","partner_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_connections_org_id_pair_key_uq" ON "company_connections" USING btree ("org_id","pair_key");--> statement-breakpoint
CREATE INDEX "company_connections_org_id_status_idx" ON "company_connections" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "network_bills_org_id_idx" ON "network_bills" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_bills_org_id_invoice_id_uq" ON "network_bills" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "network_bills_org_id_status_idx" ON "network_bills" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "network_bills_org_id_issuer_org_id_idx" ON "network_bills" USING btree ("org_id","issuer_org_id");--> statement-breakpoint
CREATE INDEX "network_payment_links_org_id_idx" ON "network_payment_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_payment_links_org_id_provider_reference_uq" ON "network_payment_links" USING btree ("org_id","provider_reference");--> statement-breakpoint
CREATE INDEX "network_payment_links_org_id_bill_id_idx" ON "network_payment_links" USING btree ("org_id","bill_id");--> statement-breakpoint
CREATE INDEX "network_projects_org_id_idx" ON "network_projects" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_projects_org_id_network_key_uq" ON "network_projects" USING btree ("org_id","network_key");--> statement-breakpoint
CREATE INDEX "network_projects_org_id_status_idx" ON "network_projects" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "invoices_org_id_recipient_org_id_idx" ON "invoices" USING btree ("org_id","recipient_org_id");
-- ---------------------------------------------------------------------------------------------
-- Custom section (written by hand, like 0002): Row-Level Security for the cross-company network.
-- Every new table holds one company's own records, so the standard tenant policy applies. The
-- mirrored rows in the partner company are written only by the named platform operations in
-- src/db/runtime.ts, and are then read under that company's own RLS context.
SELECT fieldline_enable_tenant_rls('company_connections');--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('network_projects');--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('network_bills');--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('network_payment_links');
