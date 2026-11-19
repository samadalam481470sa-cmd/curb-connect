CREATE TYPE "public"."imagery_perspective" AS ENUM('nadir', 'oblique', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."imagery_quality" AS ENUM('high', 'medium', 'low', 'base', 'unknown');--> statement-breakpoint
ALTER TYPE "public"."imagery_provider" ADD VALUE 'google_solar';--> statement-breakpoint
ALTER TYPE "public"."imagery_provider" ADD VALUE 'analysis_licensed_aerial';--> statement-breakpoint
ALTER TYPE "public"."imagery_provider" ADD VALUE 'naip';--> statement-breakpoint
ALTER TYPE "public"."imagery_provider" ADD VALUE 'local_gis';--> statement-breakpoint
ALTER TYPE "public"."imagery_provider" ADD VALUE 'lidar';--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD COLUMN "processing_date" date;--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD COLUMN "quality" "imagery_quality" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD COLUMN "perspective" "imagery_perspective" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD COLUMN "orthorectified" boolean;--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD COLUMN "sharpness_score" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD COLUMN "roof_visibility_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD COLUMN "shadow_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD COLUMN "georef_confidence" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD COLUMN "building_match_confidence" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD CONSTRAINT "imagery_assets_sharpness_ck" CHECK ("imagery_assets"."sharpness_score" is null or ("imagery_assets"."sharpness_score" >= 0 and "imagery_assets"."sharpness_score" <= 100));--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD CONSTRAINT "imagery_assets_roof_visibility_ck" CHECK ("imagery_assets"."roof_visibility_pct" is null or ("imagery_assets"."roof_visibility_pct" >= 0 and "imagery_assets"."roof_visibility_pct" <= 100));--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD CONSTRAINT "imagery_assets_shadow_ck" CHECK ("imagery_assets"."shadow_pct" is null or ("imagery_assets"."shadow_pct" >= 0 and "imagery_assets"."shadow_pct" <= 100));--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD CONSTRAINT "imagery_assets_georef_confidence_ck" CHECK ("imagery_assets"."georef_confidence" is null or ("imagery_assets"."georef_confidence" >= 0 and "imagery_assets"."georef_confidence" <= 100));--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD CONSTRAINT "imagery_assets_building_match_confidence_ck" CHECK ("imagery_assets"."building_match_confidence" is null or ("imagery_assets"."building_match_confidence" >= 0 and "imagery_assets"."building_match_confidence" <= 100));