-- Run the SupplyPro additions after every previously published Enterprise migration.
-- Some databases ran 0049_supplypro_gm when it was the last entry. Others skipped it
-- because its timestamp predated 0048. Guard both upgrade paths and preserve job origins.
ALTER TYPE public.product_line ADD VALUE IF NOT EXISTS 'remodel';
--> statement-breakpoint
ALTER TYPE public.product_line ADD VALUE IF NOT EXISTS 'service';
--> statement-breakpoint
ALTER TYPE public.product_line ADD VALUE IF NOT EXISTS 'retail';
--> statement-breakpoint
ALTER TYPE public.product_line ADD VALUE IF NOT EXISTS 'commercial';
--> statement-breakpoint
DO $$
BEGIN
  IF to_regtype('public.job_origin') IS NULL THEN
    CREATE TYPE public.job_origin AS ENUM ('manual', 'estimate', 'permit_lead');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.jobs'::regclass AND attname = 'origin' AND NOT attisdropped
  ) THEN
    ALTER TABLE public.jobs ADD COLUMN origin public.job_origin;
    UPDATE public.jobs SET origin = 'manual';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public.supplier_orders ADD COLUMN IF NOT EXISTS origin text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.supplier_orders'::regclass AND conname = 'supplier_orders_origin_check'
  ) THEN
    ALTER TABLE public.supplier_orders ADD CONSTRAINT supplier_orders_origin_check
      CHECK (origin IS NULL OR origin = 'manual');
  END IF;
END $$;
