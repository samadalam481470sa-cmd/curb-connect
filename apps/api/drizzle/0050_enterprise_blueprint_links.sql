-- Typed cross-package links between Enterprise blueprint records.
-- Additive only: existing records keep working without links.
ALTER TABLE enterprise_suite.work_package_records
  ADD CONSTRAINT enterprise_blueprint_records_org_id_key UNIQUE (org_id, id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.work_package_record_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  from_record_id uuid NOT NULL,
  to_record_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('blocks', 'evidence_for', 'billed_by', 'change_order_for')),
  note text CHECK (note IS NULL OR (length(note) <= 500 AND length(trim(note)) > 0)),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_blueprint_link_self_check CHECK (from_record_id <> to_record_id),
  CONSTRAINT enterprise_blueprint_link_from_fk FOREIGN KEY (org_id, from_record_id)
    REFERENCES enterprise_suite.work_package_records(org_id, id) ON DELETE CASCADE,
  CONSTRAINT enterprise_blueprint_link_to_fk FOREIGN KEY (org_id, to_record_id)
    REFERENCES enterprise_suite.work_package_records(org_id, id) ON DELETE CASCADE,
  CONSTRAINT enterprise_blueprint_link_unique
    UNIQUE (org_id, from_record_id, to_record_id, kind)
);
--> statement-breakpoint
CREATE INDEX enterprise_blueprint_links_from_idx
  ON enterprise_suite.work_package_record_links(org_id, kind, from_record_id);
--> statement-breakpoint
CREATE INDEX enterprise_blueprint_links_to_idx
  ON enterprise_suite.work_package_record_links(org_id, kind, to_record_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.work_package_record_links'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON enterprise_suite.work_package_record_links TO fieldline_app, fieldline_platform;
