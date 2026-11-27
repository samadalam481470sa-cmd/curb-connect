-- 0108: agent time baselines (roofing agents, audit-gaps round 2).
--   * agent_time_baselines: contractor-entered minutes saved per agent task
--     type, per organization. When an agent action completes, its
--     agent_activity_log row is auto-filled with the baseline minutes for
--     that task type. Task types without a row are not counted; the starting
--     template in code is a labeled estimate the contractor applies or
--     edits, never a fact Field Pro asserts.
CREATE TABLE public.agent_time_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  task_type text NOT NULL CHECK (length(task_type) BETWEEN 1 AND 80),
  minutes integer NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_time_baselines_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT agent_time_baselines_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT agent_time_baselines_org_id_task_type_uq UNIQUE (org_id, task_type)
);
--> statement-breakpoint
CREATE INDEX agent_time_baselines_org_id_idx ON public.agent_time_baselines(org_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.agent_time_baselines');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_time_baselines TO fieldline_app, fieldline_platform;
