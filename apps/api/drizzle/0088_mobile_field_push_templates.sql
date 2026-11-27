-- 0087: mobile field screens + push devices + estimate templates.
--   * time_clock_events: clock in/out on the phone; clock-out creates the time entry
--     (hours computed from the two timestamps, never typed by hand twice). Optional GPS
--     stamp recorded only when the device supplies it.
--   * devices: push-notification device registrations (Web Push subscriptions now;
--     iOS/Android tokens recorded the same way, delivery gated on owner accounts).
--   * estimate_templates + job_questionnaires: one-pass scoping templates that generate
--     budget lines + schedule tasks + a client questionnaire for a job.
--   * Enum additions: notification_channel 'push', media_owner_type 'inspection_result'
--     (field photos attach to an inspection result).
ALTER TYPE public.notification_channel ADD VALUE IF NOT EXISTS 'push';
--> statement-breakpoint
ALTER TYPE public.media_owner_type ADD VALUE IF NOT EXISTS 'inspection_result';
--> statement-breakpoint
CREATE TABLE public.time_clock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  membership_id uuid,
  worker_name text NOT NULL CHECK (length(worker_name) <= 160),
  job_id uuid,
  cost_code text CHECK (length(cost_code) <= 60),
  clocked_in_at timestamptz NOT NULL DEFAULT now(),
  clocked_out_at timestamptz,
  in_latitude numeric(9,6),
  in_longitude numeric(9,6),
  out_latitude numeric(9,6),
  out_longitude numeric(9,6),
  time_entry_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_clock_events_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT time_clock_events_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT time_clock_events_membership_id_fk FOREIGN KEY (org_id, membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT time_clock_events_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT time_clock_events_time_entry_id_fk FOREIGN KEY (org_id, time_entry_id) REFERENCES public.time_entries(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX time_clock_events_org_id_idx ON public.time_clock_events(org_id);
--> statement-breakpoint
CREATE INDEX time_clock_events_org_id_membership_id_idx ON public.time_clock_events(org_id, membership_id);
--> statement-breakpoint
CREATE INDEX time_clock_events_org_id_clocked_out_at_idx ON public.time_clock_events(org_id, clocked_out_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.time_clock_events');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_clock_events TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  user_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('web','ios','android')),
  endpoint text NOT NULL,
  p256dh text,
  auth text,
  user_agent text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT devices_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT devices_membership_id_fk FOREIGN KEY (org_id, membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT devices_org_membership_platform_endpoint_uq UNIQUE (org_id, membership_id, platform, endpoint)
);
--> statement-breakpoint
CREATE INDEX devices_org_id_idx ON public.devices(org_id);
--> statement-breakpoint
CREATE INDEX devices_org_id_membership_id_idx ON public.devices(org_id, membership_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.devices');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.estimate_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) <= 200),
  description text,
  budget_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule_tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  questionnaire jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_templates_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT estimate_templates_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX estimate_templates_org_id_idx ON public.estimate_templates(org_id);
--> statement-breakpoint
CREATE INDEX estimate_templates_org_id_name_idx ON public.estimate_templates(org_id, name);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.estimate_templates');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_templates TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.job_questionnaires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  template_id uuid,
  title text NOT NULL CHECK (length(title) <= 200),
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_questionnaires_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT job_questionnaires_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT job_questionnaires_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT job_questionnaires_template_id_fk FOREIGN KEY (org_id, template_id) REFERENCES public.estimate_templates(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX job_questionnaires_org_id_idx ON public.job_questionnaires(org_id);
--> statement-breakpoint
CREATE INDEX job_questionnaires_org_id_job_id_idx ON public.job_questionnaires(org_id, job_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.job_questionnaires');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_questionnaires TO fieldline_app, fieldline_platform;
--> statement-breakpoint
-- Proposals flow: honest email outcome on each sent version (same contract as
-- assignments/orders: 'sent' only after a real provider send).
ALTER TABLE public.proposal_versions
  ADD COLUMN email_state text NOT NULL DEFAULT 'not_sent'
    CHECK (email_state IN ('not_sent','queued','sent','failed','not_connected')),
  ADD COLUMN email_note text,
  ADD COLUMN email_sent_at timestamptz;
