-- Owner removal requests for building footprints on the map (see db/schema/footprintPolicy.ts).
-- Hand-written: generated output also picked up unrelated drift from earlier schema changes.
CREATE TABLE IF NOT EXISTS "footprint_removals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"radius_m" integer DEFAULT 30 NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "footprint_removals_status_ck" CHECK ("status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "footprint_removals_radius_ck" CHECK ("radius_m" between 1 and 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "footprint_removals_status_idx" ON "footprint_removals" ("status");
