-- Project punch items are isolated in the Enterprise Suite.
CREATE TABLE enterprise_suite.punch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  title varchar(255) NOT NULL CHECK (length(trim(title)) >= 2),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 3 AND 4000),
  location varchar(255) NOT NULL CHECK (length(trim(location)) > 0),
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'ready_for_review', 'closed')),
  review_note text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_punch_item_project_fk FOREIGN KEY (org_id, project_id)
    REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  UNIQUE (org_id, project_id, client_request_id)
);
--> statement-breakpoint
CREATE INDEX enterprise_punch_items_project_idx
  ON enterprise_suite.punch_items (org_id, project_id, created_at DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.punch_items'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON enterprise_suite.punch_items TO fieldline_app, fieldline_platform;
