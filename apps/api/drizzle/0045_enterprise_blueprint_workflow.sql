-- Blueprint record ownership, due dates, SLA targets and blocking.
-- Additive only: existing records start unassigned with no due date, SLA or block.
ALTER TABLE enterprise_suite.work_package_records
  ADD COLUMN owner_user_id uuid,
  ADD COLUMN due_on date,
  ADD COLUMN sla_hours integer,
  ADD COLUMN blocked_reason text,
  ADD COLUMN blocked_at timestamptz,
  ADD CONSTRAINT enterprise_blueprint_sla_hours_check
    CHECK (sla_hours IS NULL OR (sla_hours >= 1 AND sla_hours <= 8760)),
  ADD CONSTRAINT enterprise_blueprint_blocked_reason_check
    CHECK (blocked_reason IS NULL OR length(trim(blocked_reason)) > 0);
--> statement-breakpoint
CREATE INDEX enterprise_blueprint_owner_due_idx
  ON enterprise_suite.work_package_records(org_id, owner_user_id, due_on);
--> statement-breakpoint
CREATE INDEX enterprise_blueprint_due_idx
  ON enterprise_suite.work_package_records(org_id, due_on);
--> statement-breakpoint
CREATE INDEX enterprise_blueprint_blocked_idx
  ON enterprise_suite.work_package_records(org_id, blocked_at)
  WHERE blocked_reason IS NOT NULL;
