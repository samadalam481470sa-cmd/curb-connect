CREATE TABLE enterprise_suite.media_homeowner_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  active boolean NOT NULL,
  reason varchar(500) NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 500),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, contact_id, id),
  UNIQUE (org_id, project_id, contact_id, revision),
  UNIQUE (org_id, project_id, contact_id, client_request_id),
  FOREIGN KEY (org_id, project_id)
    REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_homeowner_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  homeowner_id uuid NOT NULL,
  recipient_grant_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  expires_at timestamptz NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_sealed text NOT NULL CHECK (octet_length(token_sealed) <= 256),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, project_id, revision),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id, homeowner_id, recipient_grant_id)
    REFERENCES enterprise_suite.media_homeowner_recipients(org_id, project_id, contact_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_homeowner_share_items (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  share_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  preview_id uuid NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 39),
  PRIMARY KEY (org_id, project_id, share_id, preview_id),
  FOREIGN KEY (org_id, project_id, share_id)
    REFERENCES enterprise_suite.media_homeowner_shares(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, asset_id, preview_id)
    REFERENCES enterprise_suite.media_customer_photo_previews(org_id, project_id, asset_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_homeowner_share_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  share_id uuid NOT NULL,
  reason varchar(500) NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 500),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, share_id),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id, share_id)
    REFERENCES enterprise_suite.media_homeowner_shares(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_homeowner_recipients'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_homeowner_shares'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_homeowner_share_items'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_homeowner_share_revocations'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.media_homeowner_recipients,
  enterprise_suite.media_homeowner_shares, enterprise_suite.media_homeowner_share_items,
  enterprise_suite.media_homeowner_share_revocations TO fieldline_app, fieldline_platform;
