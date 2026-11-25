CREATE TABLE enterprise_suite.document_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  title varchar(180) NOT NULL CHECK (length(trim(title)) >= 2),
  category text NOT NULL CHECK (category IN ('plans', 'specifications', 'contract', 'inspection', 'other')),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_document_sets_project_idx ON enterprise_suite.document_sets(org_id, project_id, created_at DESC, id DESC);
--> statement-breakpoint
ALTER TABLE enterprise_suite.documents
  ADD COLUMN document_set_id uuid,
  ADD COLUMN client_request_id uuid,
  ADD COLUMN scan_status text NOT NULL DEFAULT 'not_scanned' CHECK (scan_status IN ('clean', 'not_scanned')),
  ADD COLUMN revision_note text,
  ADD CONSTRAINT enterprise_document_set_fk FOREIGN KEY (org_id, project_id, document_set_id)
    REFERENCES enterprise_suite.document_sets(org_id, project_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT enterprise_document_project_identity UNIQUE (org_id, project_id, id),
  ADD CONSTRAINT enterprise_document_set_version UNIQUE (org_id, project_id, document_set_id, version),
  ADD CONSTRAINT enterprise_document_request UNIQUE (org_id, project_id, client_request_id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.document_reviews (
  version_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  note text NOT NULL CHECK (length(trim(note)) BETWEEN 3 AND 1000),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, version_id) REFERENCES enterprise_suite.documents(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.document_sets'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.document_reviews'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.document_sets, enterprise_suite.document_reviews TO fieldline_app, fieldline_platform;
