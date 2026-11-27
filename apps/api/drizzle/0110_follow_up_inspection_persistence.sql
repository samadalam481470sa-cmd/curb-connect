-- 0106: follow-up + inspection persistence (roofing agents).
--   * follow_up_overrides: per-item manual state for the follow-up queue
--     (snooze / completion / cadence override), keyed by the stable queue
--     item id (`funnel:<leadKey>` or `roof-order:<roofOrderId>`). The queue
--     itself stays derived from funnel stages + quoted roof orders.
--   * roof_inspections: Front Desk inspection bookings. Job-linked bookings
--     are also mirrored to the `schedules` crew-calendar table (schedule_id).
-- Both stores were in-memory only before this migration (process lifetime);
-- the endpoints and response shapes are unchanged.
CREATE TABLE public.follow_up_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  item_id text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 300),
  snoozed_until timestamptz,
  completed_at timestamptz,
  last_outcome text CHECK (last_outcome IS NULL OR length(last_outcome) <= 40),
  last_note text CHECK (last_note IS NULL OR length(last_note) <= 1000),
  cadence_days integer CHECK (cadence_days IS NULL OR cadence_days BETWEEN 1 AND 90),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT follow_up_overrides_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT follow_up_overrides_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT follow_up_overrides_org_id_item_id_uq UNIQUE (org_id, item_id)
);
--> statement-breakpoint
CREATE INDEX follow_up_overrides_org_id_idx ON public.follow_up_overrides(org_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.follow_up_overrides');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.follow_up_overrides TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.roof_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  address text NOT NULL CHECK (length(address) BETWEEN 2 AND 300),
  city text CHECK (city IS NULL OR length(city) <= 100),
  job_id uuid,
  roof_order_id uuid,
  crew_id uuid,
  inspector_name text CHECK (inspector_name IS NULL OR length(inspector_name) <= 200),
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 30 AND 240),
  ends_at timestamptz NOT NULL,
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','confirmed','completed','cancelled')),
  schedule_id uuid,
  scheduled_in_crew_calendar boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roof_inspections_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT roof_inspections_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT roof_inspections_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT roof_inspections_roof_order_id_fk FOREIGN KEY (org_id, roof_order_id) REFERENCES public.roof_orders(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT roof_inspections_crew_id_fk FOREIGN KEY (org_id, crew_id) REFERENCES public.crews(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT roof_inspections_schedule_id_fk FOREIGN KEY (org_id, schedule_id) REFERENCES public.schedules(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX roof_inspections_org_id_idx ON public.roof_inspections(org_id);
--> statement-breakpoint
CREATE INDEX roof_inspections_org_id_status_idx ON public.roof_inspections(org_id, status);
--> statement-breakpoint
CREATE INDEX roof_inspections_org_id_starts_at_idx ON public.roof_inspections(org_id, starts_at);
--> statement-breakpoint
CREATE INDEX roof_inspections_org_id_job_id_idx ON public.roof_inspections(org_id, job_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.roof_inspections');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_inspections TO fieldline_app, fieldline_platform;
