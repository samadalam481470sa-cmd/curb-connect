-- Roof insurance claims + agent activity log (additive).
-- The photo inspection report (apps/web/src/features/roof/inspection/) is the evidence a
-- claim needs: it lives in the browser as a draft, so a claim document links it by its
-- inspection id (roof_claim_documents.inspection_report_id) and/or by an already-stored
-- media asset (media_asset_id). No raw blobs are stored here, only references.
-- Hours saved are COMPUTED from agent_activity_log.minutes_saved, never stored as a
-- headline number; a null minutes_saved means "not measured", never zero.
-- Tenant-scoped; RLS follows the same pattern as land_scout (drizzle/0002_rls_triggers.sql).
-- NOTE: written by hand in the style of 0035. The drizzle meta snapshot was left untouched
-- (see the 0035 note: `drizzle-kit generate` currently emits the whole schema because the
-- meta snapshot drifted from the hand-edited migrations).
CREATE TABLE public.roof_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  roof_order_id uuid NOT NULL,
  carrier text NOT NULL,
  adjuster_name text,
  adjuster_contact text,
  claim_number text,
  status text NOT NULL DEFAULT 'filed' CHECK (status IN ('filed', 'adjuster_assigned', 'inspection_scheduled', 'estimate_submitted', 'approved', 'denied', 'settled')),
  note text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roof_claims_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT roof_claims_roof_order_fk FOREIGN KEY (org_id, roof_order_id) REFERENCES public.roof_orders (org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.roof_claim_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  claim_id uuid NOT NULL,
  media_asset_id uuid,
  inspection_report_id text,
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('inspection_report', 'photo', 'estimate', 'correspondence', 'other')),
  label text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roof_claim_documents_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT roof_claim_documents_claim_fk FOREIGN KEY (org_id, claim_id) REFERENCES public.roof_claims (org_id, id) ON DELETE CASCADE,
  CONSTRAINT roof_claim_documents_media_asset_fk FOREIGN KEY (org_id, media_asset_id) REFERENCES public.media_assets (org_id, id) ON DELETE SET NULL,
  CONSTRAINT roof_claim_documents_has_reference_ck CHECK (media_asset_id IS NOT NULL OR inspection_report_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE public.agent_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  agent text NOT NULL CHECK (agent IN ('storms', 'estimator', 'claims', 'scheduler', 'follow-ups', 'front_desk')),
  action text NOT NULL,
  minutes_saved integer CHECK (minutes_saved IS NULL OR minutes_saved >= 0),
  related_type text CHECK (related_type IS NULL OR related_type IN ('roof_order', 'roof_claim', 'lead')),
  related_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_activity_log_org_id_id_uq UNIQUE (org_id, id)
);
--> statement-breakpoint
CREATE INDEX roof_claims_org_roof_order_idx ON public.roof_claims (org_id, roof_order_id);
--> statement-breakpoint
CREATE INDEX roof_claims_org_status_idx ON public.roof_claims (org_id, status);
--> statement-breakpoint
CREATE INDEX roof_claim_documents_org_claim_idx ON public.roof_claim_documents (org_id, claim_id);
--> statement-breakpoint
CREATE INDEX agent_activity_log_org_agent_idx ON public.agent_activity_log (org_id, agent, created_at DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.roof_claims');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.roof_claim_documents');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.agent_activity_log');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_claims TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_claim_documents TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_activity_log TO fieldline_app, fieldline_platform;
