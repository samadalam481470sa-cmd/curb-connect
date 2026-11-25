-- Evidence-backed requirements for the 18 control-level addendum gates.
-- Additive only: one assignment row per organization/module/gate, plus reviewed evidence and
-- optional encrypted object-storage attachments. RLS keeps every row inside the verified tenant.
CREATE TABLE enterprise_suite.control_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  module_key text NOT NULL CHECK (module_key ~ '^[a-z][a-z0-9-]{1,60}$'),
  gate_key text NOT NULL CHECK (gate_key ~ '^[a-z][a-z0-9-]{1,60}$'),
  owner_user_id uuid,
  expires_on date,
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_control_requirement_identity UNIQUE (org_id, module_key, gate_key)
);
--> statement-breakpoint
CREATE INDEX enterprise_control_requirements_owner_idx
  ON enterprise_suite.control_requirements(org_id, owner_user_id, expires_on);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.control_requirements'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON enterprise_suite.control_requirements TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE enterprise_suite.control_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  module_key text NOT NULL,
  gate_key text NOT NULL,
  title varchar(180) NOT NULL CHECK (length(trim(title)) >= 2),
  note text CHECK (note IS NULL OR length(note) <= 4000),
  evidence_on date NOT NULL,
  expires_on date,
  source_reference text CHECK (source_reference IS NULL OR length(source_reference) <= 1000),
  filename text,
  storage_key text,
  file_sha256 varchar(64) CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
  file_bytes bigint CHECK (file_bytes IS NULL OR file_bytes > 0),
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'accepted', 'rejected')),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 2000),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_control_evidence_attachment_check CHECK (
    (filename IS NULL AND storage_key IS NULL AND file_sha256 IS NULL AND file_bytes IS NULL)
    OR (filename IS NOT NULL AND storage_key IS NOT NULL AND file_sha256 IS NOT NULL AND file_bytes IS NOT NULL)
  ),
  CONSTRAINT enterprise_control_evidence_review_check CHECK (
    (review_status = 'pending' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_note IS NULL)
    OR (review_status IN ('accepted', 'rejected') AND reviewed_by_user_id IS NOT NULL
      AND reviewed_at IS NOT NULL AND review_note IS NOT NULL)
  ),
  CONSTRAINT enterprise_control_evidence_requirement_fk
    FOREIGN KEY (org_id, module_key, gate_key)
    REFERENCES enterprise_suite.control_requirements(org_id, module_key, gate_key)
    ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX enterprise_control_evidence_gate_idx
  ON enterprise_suite.control_evidence(org_id, module_key, gate_key, created_at DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.control_evidence'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON enterprise_suite.control_evidence TO fieldline_app, fieldline_platform;
