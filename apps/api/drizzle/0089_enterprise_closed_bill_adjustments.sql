CREATE TABLE enterprise_suite.closed_bill_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  bill_id uuid NOT NULL,
  approval_event_id uuid NOT NULL,
  period_start date NOT NULL CHECK (extract(day from period_start) = 1),
  period_revision_id uuid NOT NULL,
  posting_on date NOT NULL CHECK (
    posting_on >= period_start AND posting_on < (period_start + interval '1 month')::date
  ),
  allocation_split jsonb NOT NULL CHECK (
    jsonb_typeof(allocation_split) = 'array' AND jsonb_array_length(allocation_split) BETWEEN 1 AND 100
  ),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  requested_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, bill_id) REFERENCES public.network_bills(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, approval_event_id) REFERENCES public.audit_events(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, period_start, period_revision_id)
    REFERENCES enterprise_suite.cost_period_revisions(org_id, period_start, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_closed_bill_adjustments_project_idx
  ON enterprise_suite.closed_bill_adjustments (org_id, project_id, created_at DESC, id DESC);
--> statement-breakpoint
ALTER TABLE enterprise_suite.actual_bill_postings
  ADD COLUMN adjustment_request_id uuid,
  ADD CONSTRAINT enterprise_bill_posting_adjustment_fk
    FOREIGN KEY (org_id, project_id, adjustment_request_id)
      REFERENCES enterprise_suite.closed_bill_adjustments(org_id, project_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT enterprise_bill_posting_adjustment_uniq UNIQUE (org_id, adjustment_request_id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.closed_bill_adjustment_decisions (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  adjustment_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('approved', 'rejected')),
  posting_id uuid,
  CHECK ((outcome = 'approved') = (posting_id IS NOT NULL)),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  decided_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, project_id, adjustment_id),
  UNIQUE (org_id, client_request_id),
  UNIQUE (org_id, posting_id),
  FOREIGN KEY (org_id, project_id, adjustment_id)
    REFERENCES enterprise_suite.closed_bill_adjustments(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, posting_id)
    REFERENCES enterprise_suite.actual_bill_postings(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.closed_bill_adjustments'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.closed_bill_adjustment_decisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.closed_bill_adjustments, enterprise_suite.closed_bill_adjustment_decisions
  TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE FUNCTION enterprise_suite.enforce_bill_posting_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_period enterprise_suite.cost_period_revisions%ROWTYPE;
BEGIN
  SELECT * INTO current_period FROM enterprise_suite.cost_period_revisions
  WHERE org_id = NEW.org_id AND period_start = NEW.period_start
  ORDER BY version DESC LIMIT 1;

  IF current_period.id IS DISTINCT FROM NEW.period_revision_id THEN
    RAISE EXCEPTION 'use the current accounting period revision' USING ERRCODE = '23514';
  END IF;
  IF current_period.state = 'open' AND NEW.adjustment_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_period.state = 'closed' AND EXISTS (
    SELECT 1 FROM enterprise_suite.closed_bill_adjustments AS request
    WHERE request.org_id = NEW.org_id AND request.project_id = NEW.project_id
      AND request.id = NEW.adjustment_request_id AND request.bill_id = NEW.bill_id
      AND request.approval_event_id = NEW.approval_event_id
      AND request.period_revision_id = NEW.period_revision_id AND request.posting_on = NEW.posting_on
      AND request.requested_by_user_id <> NEW.posted_by_user_id
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a closed period requires a separate approved adjustment' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER enterprise_bill_posting_period_guard
BEFORE INSERT ON enterprise_suite.actual_bill_postings
FOR EACH ROW EXECUTE FUNCTION enterprise_suite.enforce_bill_posting_period();
--> statement-breakpoint
CREATE FUNCTION enterprise_suite.enforce_bill_adjustment_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM enterprise_suite.closed_bill_adjustment_decisions AS decision
    WHERE decision.org_id = NEW.org_id AND decision.project_id = NEW.project_id
      AND decision.adjustment_id = NEW.adjustment_request_id AND decision.posting_id = NEW.id
      AND decision.outcome = 'approved' AND decision.decided_by_user_id = NEW.posted_by_user_id
  ) THEN
    RAISE EXCEPTION 'the closed-period adjustment needs its approval record' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM enterprise_suite.closed_bill_adjustments AS request
    WHERE request.org_id = NEW.org_id AND request.project_id = NEW.project_id
      AND request.id = NEW.adjustment_request_id AND request.allocation_split = (
        SELECT jsonb_agg(jsonb_build_object(
          'costCodeId', split.cost_code_id, 'amountMinor', split.amount_minor
        ) ORDER BY split.cost_code_id)
        FROM enterprise_suite.actual_bill_allocations AS split
        WHERE split.org_id = NEW.org_id AND split.project_id = NEW.project_id AND split.posting_id = NEW.id
      )
  ) THEN
    RAISE EXCEPTION 'posted allocations must match the approved adjustment split' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER enterprise_bill_adjustment_requires_decision
AFTER INSERT ON enterprise_suite.actual_bill_postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.adjustment_request_id IS NOT NULL)
EXECUTE FUNCTION enterprise_suite.enforce_bill_adjustment_decision();
