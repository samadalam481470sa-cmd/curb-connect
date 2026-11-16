-- Customer job-status links. A contractor shares a secret link (portal_tokens, scope 'job') and
-- posts customer-visible updates; the customer opens the link without an account and sees only the
-- job title, its stage and these updates. Internal job_events, money and contacts never leave.
CREATE TABLE public.job_customer_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('intake','estimating','scheduled','in_progress','completed')),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_customer_updates_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT job_customer_updates_job_id_fk FOREIGN KEY (org_id,job_id)
    REFERENCES public.jobs(org_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX job_customer_updates_org_id_idx ON public.job_customer_updates(org_id);
--> statement-breakpoint
CREATE INDEX job_customer_updates_org_id_job_id_created_at_idx
  ON public.job_customer_updates(org_id,job_id,created_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.job_customer_updates');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_customer_updates TO fieldline_app, fieldline_platform;
--> statement-breakpoint
-- Who a job-status link was shared with. sealed_token is the link token encrypted with a key
-- derived from SESSION_SECRET, so update emails can repeat the link; token_hash stays the lookup.
ALTER TABLE public.portal_tokens ADD COLUMN IF NOT EXISTS recipient_name text
  CHECK (recipient_name IS NULL OR length(recipient_name) <= 120);
--> statement-breakpoint
ALTER TABLE public.portal_tokens ADD COLUMN IF NOT EXISTS recipient_email text
  CHECK (recipient_email IS NULL OR length(recipient_email) <= 254);
--> statement-breakpoint
ALTER TABLE public.portal_tokens ADD COLUMN IF NOT EXISTS sealed_token text;
