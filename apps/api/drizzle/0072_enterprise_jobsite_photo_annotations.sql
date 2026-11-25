ALTER TABLE enterprise_suite.media_assets
  ADD COLUMN annotation_revision integer NOT NULL DEFAULT 0 CHECK (annotation_revision >= 0);
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_photo_annotation_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  annotations jsonb NOT NULL CHECK (
    jsonb_typeof(annotations) = 'array' AND jsonb_array_length(annotations) BETWEEN 1 AND 50
  ),
  source_sha256 varchar(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 1920),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 1920),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, asset_id, revision),
  UNIQUE (org_id, project_id, asset_id, client_request_id),
  FOREIGN KEY (org_id, project_id, asset_id)
    REFERENCES enterprise_suite.media_assets(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_photo_annotation_revisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.media_photo_annotation_revisions TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (annotation_revision) ON enterprise_suite.media_assets TO fieldline_app, fieldline_platform;
