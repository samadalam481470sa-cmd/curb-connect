CREATE TABLE enterprise_suite.media_project_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  active boolean NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, membership_id, revision),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  local_capture_id uuid NOT NULL,
  uploader_user_id uuid NOT NULL,
  filename varchar(120) NOT NULL CHECK (length(filename) > 0),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  manifest_hash varchar(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  finalized_at timestamptz,
  finalized_request_id uuid,
  CHECK ((finalized_at IS NULL) = (finalized_request_id IS NULL)),
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, uploader_user_id, local_capture_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_upload_parts (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  session_id uuid NOT NULL,
  part_number integer NOT NULL CHECK (part_number BETWEEN 0 AND 24),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 1048576),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, project_id, session_id, part_number),
  FOREIGN KEY (org_id, project_id, session_id)
    REFERENCES enterprise_suite.media_upload_sessions(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_assets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  scan_state text NOT NULL DEFAULT 'pending'
    CHECK (scan_state IN ('pending', 'clean', 'infected', 'unsupported', 'scan_failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  scanned_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((scan_state = 'pending') = (scanned_at IS NULL)),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id, id)
    REFERENCES enterprise_suite.media_upload_sessions(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_media_assets_project_idx
  ON enterprise_suite.media_assets(org_id, project_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_project_grants'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_upload_sessions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_upload_parts'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_assets'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.media_project_grants, enterprise_suite.media_upload_sessions,
  enterprise_suite.media_upload_parts, enterprise_suite.media_assets TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (revision, finalized_at, finalized_request_id) ON enterprise_suite.media_upload_sessions
  TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (scan_state, scanned_at, revision) ON enterprise_suite.media_assets TO fieldline_app, fieldline_platform;
