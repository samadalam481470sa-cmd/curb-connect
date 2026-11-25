-- SupplyPro GM core: widen job types, mark job origin, mark manual supplier orders.
-- Additive only. New product-line values join the existing 'roof'/'curb' values;
-- existing jobs backfill origin 'manual' because every job before this column was
-- created by hand through POST /v1/jobs. Supplier orders created through the
-- flag-free manual flow carry origin 'manual'; flag-path orders stay null.
ALTER TYPE "public"."product_line" ADD VALUE 'remodel';--> statement-breakpoint
ALTER TYPE "public"."product_line" ADD VALUE 'service';--> statement-breakpoint
ALTER TYPE "public"."product_line" ADD VALUE 'retail';--> statement-breakpoint
ALTER TYPE "public"."product_line" ADD VALUE 'commercial';--> statement-breakpoint
CREATE TYPE "public"."job_origin" AS ENUM('manual', 'estimate', 'permit_lead');--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "origin" "public"."job_origin";--> statement-breakpoint
UPDATE "jobs" SET "origin" = 'manual';--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_origin_check"
  CHECK ("origin" IS NULL OR "origin" = 'manual');
