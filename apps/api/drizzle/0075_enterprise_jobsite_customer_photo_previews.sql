CREATE TABLE enterprise_suite.media_customer_photo_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  source_annotation_revision integer NOT NULL CHECK (source_annotation_revision >= 0),
  source_sha256 varchar(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 1920),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 1920),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  redaction_count integer NOT NULL CHECK (redaction_count BETWEEN 0 AND 50),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, asset_id, id),
  UNIQUE (org_id, project_id, asset_id, revision),
  UNIQUE (org_id, project_id, asset_id, client_request_id),
  FOREIGN KEY (org_id, project_id, asset_id)
    REFERENCES enterprise_suite.media_assets(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_customer_photo_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  preview_id uuid NOT NULL,
  reason varchar(500) NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 500),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, asset_id, preview_id),
  UNIQUE (org_id, project_id, asset_id, client_request_id),
  FOREIGN KEY (org_id, project_id, asset_id, preview_id)
    REFERENCES enterprise_suite.media_customer_photo_previews(org_id, project_id, asset_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_customer_photo_previews'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_customer_photo_approvals'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.media_customer_photo_previews,
  enterprise_suite.media_customer_photo_approvals TO fieldline_app, fieldline_platform;
