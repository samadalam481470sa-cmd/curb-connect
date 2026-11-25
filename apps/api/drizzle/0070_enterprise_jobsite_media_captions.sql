ALTER TABLE enterprise_suite.media_assets
  ADD COLUMN caption_revision integer NOT NULL DEFAULT 0 CHECK (caption_revision >= 0),
  ADD COLUMN caption_search text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_caption_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  caption text NOT NULL CHECK (length(caption) <= 2000),
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
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
CREATE INDEX enterprise_jobsite_media_caption_search_idx
  ON enterprise_suite.media_assets USING gin (to_tsvector('simple', caption_search));
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_caption_revisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.media_caption_revisions TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (caption_revision, caption_search) ON enterprise_suite.media_assets TO fieldline_app, fieldline_platform;
