CREATE TABLE enterprise_suite.media_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  requester_membership_id uuid NOT NULL,
  requester_user_id uuid NOT NULL,
  format varchar(8) NOT NULL CHECK (format IN ('zip', 'pdf')),
  selection varchar(16) NOT NULL CHECK (selection IN ('original', 'current')),
  manifest jsonb NOT NULL CHECK (
    jsonb_typeof(manifest) = 'array' AND jsonb_array_length(manifest) BETWEEN 1 AND 40
  ),
  status varchar(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  failure_code varchar(40),
  byte_size integer CHECK (byte_size BETWEEN 1 AND 67108864),
  sha256 varchar(64) CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (
    (status = 'ready' AND sha256 IS NOT NULL AND byte_size IS NOT NULL AND completed_at IS NOT NULL)
    OR (status <> 'ready' AND sha256 IS NULL AND byte_size IS NULL)
  ),
  CHECK (
    (status = 'failed' AND failure_code IS NOT NULL AND completed_at IS NOT NULL)
    OR (status <> 'failed' AND failure_code IS NULL)
  ),
  UNIQUE (org_id, project_id, requester_user_id, client_request_id),
  FOREIGN KEY (org_id, project_id)
    REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_media_exports_requester_idx
  ON enterprise_suite.media_exports (org_id, project_id, requester_user_id, created_at DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_exports'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.media_exports TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (status, failure_code, byte_size, sha256, completed_at)
  ON enterprise_suite.media_exports TO fieldline_platform;
