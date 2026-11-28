-- 0113: house/development end-to-end connectivity (BuilderGM-style flow).
--   * product_line 'new_construction' and job_origin 'assignment' enum values.
--   * land_feasibility_projects.community_id — the community a saved feasibility
--     project was converted into (the idempotency anchor for conversion).
--   * jobs.land_house_id / jobs.studio_house_id — back-references from a build job
--     to the house and plan it builds; jobs.assignment_key — the work assignment a
--     mirrored job was created from (unique per org when set, so accepting twice
--     cannot create two mirrored jobs).
--   * estimates.studio_house_id + relaxed subject check — a House Studio plan can be
--     an estimate subject; estimate_revisions.price_book_revision_id becomes nullable
--     because studio estimates price from the NAHB survey model, not a price book.
--   * work_assignments: 'house_build' / 'development_phase' kinds, a payload snapshot
--     (plan, budget and schedule as they stood at assignment time), mirrored_job_id.
--   * schedule_tasks.cost_code + assignee_org_id (+ display-name snapshot) so a trade
--     scope can be assigned to a connected company per task.
ALTER TYPE public.product_line ADD VALUE IF NOT EXISTS 'new_construction';
--> statement-breakpoint
ALTER TYPE public.job_origin ADD VALUE IF NOT EXISTS 'assignment';
--> statement-breakpoint
ALTER TABLE public.land_feasibility_projects ADD COLUMN IF NOT EXISTS community_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.land_feasibility_projects'::regclass
      AND conname = 'land_feasibility_projects_community_id_fk'
  ) THEN
    ALTER TABLE public.land_feasibility_projects
      ADD CONSTRAINT land_feasibility_projects_community_id_fk
      FOREIGN KEY (org_id, community_id) REFERENCES public.land_communities(org_id, id) ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS land_house_id uuid;
--> statement-breakpoint
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS studio_house_id uuid;
--> statement-breakpoint
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS assignment_key uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_land_house_id_fk'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_land_house_id_fk
      FOREIGN KEY (org_id, land_house_id) REFERENCES public.land_houses(org_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_studio_house_id_fk'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_studio_house_id_fk
      FOREIGN KEY (org_id, studio_house_id) REFERENCES public.studio_houses(org_id, id) ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS jobs_org_id_assignment_key_uq
  ON public.jobs(org_id, assignment_key) WHERE assignment_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_org_id_land_house_id_idx ON public.jobs(org_id, land_house_id);
--> statement-breakpoint
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS studio_house_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.estimates'::regclass AND conname = 'estimates_studio_house_id_fk'
  ) THEN
    ALTER TABLE public.estimates
      ADD CONSTRAINT estimates_studio_house_id_fk
      FOREIGN KEY (org_id, studio_house_id) REFERENCES public.studio_houses(org_id, id) ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS estimates_org_id_studio_house_id_idx ON public.estimates(org_id, studio_house_id);
--> statement-breakpoint
ALTER TABLE public.estimates DROP CONSTRAINT IF EXISTS estimates_subject_ck;
--> statement-breakpoint
ALTER TABLE public.estimates ADD CONSTRAINT estimates_subject_ck
  CHECK (curb_project_id IS NOT NULL OR roof_order_id IS NOT NULL OR studio_house_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE public.estimate_revisions ALTER COLUMN price_book_revision_id DROP NOT NULL;
--> statement-breakpoint
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'public.work_assignments'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%bid_invitation%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.work_assignments DROP CONSTRAINT %I', c);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.work_assignments'::regclass AND conname = 'work_assignments_kind_check'
  ) THEN
    ALTER TABLE public.work_assignments ADD CONSTRAINT work_assignments_kind_check
      CHECK (kind IN ('job','purchase_order','task','bid_invitation','house_build','development_phase'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public.work_assignments ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE public.work_assignments ADD COLUMN IF NOT EXISTS mirrored_job_id uuid;
--> statement-breakpoint
ALTER TABLE public.schedule_tasks ADD COLUMN IF NOT EXISTS cost_code text;
--> statement-breakpoint
ALTER TABLE public.schedule_tasks ADD COLUMN IF NOT EXISTS assignee_org_id uuid;
--> statement-breakpoint
ALTER TABLE public.schedule_tasks ADD COLUMN IF NOT EXISTS assignee_display_name text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS schedule_tasks_org_id_assignee_org_id_idx ON public.schedule_tasks(org_id, assignee_org_id);
