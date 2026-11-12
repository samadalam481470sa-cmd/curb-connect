-- Account-scoped, persistent project workspace drafts. No browser-only state or email-keyed records.
-- Keep both company and owner UUID in the UNIQUE key so users switching organizations cannot leak data.
CREATE TABLE public.user_workspace_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  draft_key text NOT NULL CHECK (length(draft_key) BETWEEN 1 AND 80),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_workspace_drafts_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT user_workspace_drafts_org_id_user_id_draft_key_uq UNIQUE (org_id,user_id,draft_key)
);
--> statement-breakpoint
CREATE INDEX user_workspace_drafts_org_id_idx ON public.user_workspace_drafts(org_id);
--> statement-breakpoint
CREATE INDEX user_workspace_drafts_org_id_user_id_idx ON public.user_workspace_drafts(org_id,user_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.user_workspace_drafts');
--> statement-breakpoint
-- The standard tenant policy alone would allow another employee within the same company.
-- Replace it with a policy that enforces BOTH authenticated user and organization.
DROP POLICY tenant_isolation ON public.user_workspace_drafts;
--> statement-breakpoint
CREATE POLICY personal_workspace_draft_access ON public.user_workspace_drafts
  FOR ALL TO fieldline_app
  USING (org_id = fieldline_current_org_id() AND user_id = fieldline_current_user_id())
  WITH CHECK (org_id = fieldline_current_org_id() AND user_id = fieldline_current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_workspace_drafts TO fieldline_app, fieldline_platform;
