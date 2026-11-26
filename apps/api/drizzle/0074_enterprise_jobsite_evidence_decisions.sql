CREATE TABLE enterprise_suite.media_evidence_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  review_id uuid NOT NULL,
  decision varchar(24) NOT NULL CHECK (decision IN ('approved', 'changes_requested', 'rejected')),
  findings varchar(1500) NOT NULL CHECK (char_length(trim(findings)) BETWEEN 1 AND 1500),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, task_id, review_id),
  UNIQUE (org_id, project_id, task_id, client_request_id),
  FOREIGN KEY (org_id, project_id, task_id, review_id)
    REFERENCES enterprise_suite.media_evidence_review_tasks(org_id, project_id, task_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_evidence_review_decisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.media_evidence_review_decisions TO fieldline_app, fieldline_platform;
