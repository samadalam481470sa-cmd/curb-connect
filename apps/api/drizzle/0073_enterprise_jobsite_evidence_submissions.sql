CREATE TABLE enterprise_suite.media_evidence_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  contractor_membership_id uuid NOT NULL,
  reviewer_membership_id uuid NOT NULL,
  minimum_media integer NOT NULL CHECK (minimum_media BETWEEN 1 AND 20),
  active boolean NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contractor_membership_id <> reviewer_membership_id),
  UNIQUE (org_id, project_id, task_id, id),
  UNIQUE (org_id, project_id, task_id, revision),
  UNIQUE (org_id, project_id, task_id, client_request_id),
  FOREIGN KEY (org_id, project_id, task_id)
    REFERENCES enterprise_suite.schedule_tasks(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_evidence_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  media_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(media_snapshot) = 'array' AND jsonb_array_length(media_snapshot) BETWEEN 1 AND 20
  ),
  note varchar(1500) NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, task_id, id),
  UNIQUE (org_id, project_id, task_id, revision),
  UNIQUE (org_id, project_id, task_id, client_request_id),
  FOREIGN KEY (org_id, project_id, task_id, assignment_id)
    REFERENCES enterprise_suite.media_evidence_assignments(org_id, project_id, task_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.media_evidence_review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  reviewer_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, task_id, submission_id),
  UNIQUE (org_id, project_id, task_id, id),
  FOREIGN KEY (org_id, project_id, task_id, submission_id)
    REFERENCES enterprise_suite.media_evidence_submissions(org_id, project_id, task_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_media_evidence_review_tasks_reviewer_idx
  ON enterprise_suite.media_evidence_review_tasks (org_id, reviewer_membership_id, created_at DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_evidence_assignments'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_evidence_submissions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.media_evidence_review_tasks'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.media_evidence_assignments,
  enterprise_suite.media_evidence_submissions, enterprise_suite.media_evidence_review_tasks TO fieldline_app, fieldline_platform;
