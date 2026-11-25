ALTER TABLE enterprise_suite.media_upload_sessions
  ADD COLUMN declared_duration_ms integer,
  DROP CONSTRAINT media_upload_sessions_mime_type_check,
  ADD CONSTRAINT enterprise_media_upload_manifest_kind CHECK (
    (mime_type IN ('image/jpeg', 'image/png', 'image/webp') AND declared_duration_ms IS NULL)
    OR
    (mime_type IN ('video/mp4', 'video/webm') AND declared_duration_ms IS NOT NULL
      AND declared_duration_ms BETWEEN 1 AND 60000)
  );
--> statement-breakpoint
ALTER TABLE enterprise_suite.media_assets
  ADD COLUMN video_state text CHECK (video_state IN ('queued', 'processing', 'ready', 'rejected', 'failed'));
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_video_derivatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  source_sha256 varchar(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 1 AND 60000),
  width integer NOT NULL CHECK (width BETWEEN 2 AND 1280),
  height integer NOT NULL CHECK (height BETWEEN 2 AND 1280),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, asset_id, version),
  FOREIGN KEY (org_id, project_id, asset_id)
    REFERENCES enterprise_suite.media_assets(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_video_derivatives'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.media_video_derivatives TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (video_state) ON enterprise_suite.media_assets TO fieldline_app, fieldline_platform;
