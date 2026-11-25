CREATE TABLE enterprise_suite.takeoff_measurement_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  length_id uuid,
  area_id uuid,
  count_id uuid,
  measurement_id uuid GENERATED ALWAYS AS (coalesce(length_id, area_id, count_id)) STORED NOT NULL,
  measurement_kind text GENERATED ALWAYS AS (
    CASE WHEN length_id IS NOT NULL THEN 'length' WHEN area_id IS NOT NULL THEN 'area' ELSE 'count' END
  ) STORED NOT NULL,
  measurement_revision integer NOT NULL CHECK (measurement_revision > 0),
  calibration_id uuid,
  quantity double precision NOT NULL CHECK (quantity >= 0 AND quantity < 'Infinity'::float8),
  unit varchar(16),
  status text NOT NULL DEFAULT 'review_required' CHECK (status IN ('review_required', 'approved', 'changes_requested')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  submit_note text NOT NULL CHECK (length(trim(submit_note)) BETWEEN 3 AND 1000),
  submitted_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  review_note text CHECK (review_note IS NULL OR length(trim(review_note)) BETWEEN 3 AND 1000),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  client_request_id uuid NOT NULL,
  CHECK (num_nonnulls(length_id, area_id, count_id) = 1),
  CHECK ((count_id IS NULL) = (calibration_id IS NOT NULL) AND (count_id IS NULL) = (unit IS NOT NULL)),
  CHECK (
    (status = 'review_required' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL AND review_note IS NULL)
    OR (status <> 'review_required' AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND review_note IS NOT NULL)
  ),
  UNIQUE (org_id, project_id, plan_id, sheet_id, client_request_id),
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, length_id)
    REFERENCES enterprise_suite.takeoff_lengths(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, area_id)
    REFERENCES enterprise_suite.takeoff_areas(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, count_id)
    REFERENCES enterprise_suite.takeoff_count_sets(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, calibration_id)
    REFERENCES enterprise_suite.takeoff_calibrations(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX enterprise_takeoff_current_review_idx
  ON enterprise_suite.takeoff_measurement_reviews
  (org_id, project_id, plan_id, sheet_id, measurement_kind, measurement_id, measurement_revision)
  WHERE status IN ('review_required', 'approved');
--> statement-breakpoint
CREATE INDEX enterprise_takeoff_reviews_sheet_idx
  ON enterprise_suite.takeoff_measurement_reviews
  (org_id, project_id, plan_id, sheet_id, measurement_kind, measurement_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE FUNCTION enterprise_suite.guard_takeoff_review_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'review_required' OR NEW.status = 'review_required' OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'A takeoff review decision may only be made once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_takeoff_review_decision BEFORE UPDATE ON enterprise_suite.takeoff_measurement_reviews
  FOR EACH ROW EXECUTE FUNCTION enterprise_suite.guard_takeoff_review_decision();
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_measurement_reviews'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_measurement_reviews TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (status, revision, review_note, reviewed_by_user_id, reviewed_at)
  ON enterprise_suite.takeoff_measurement_reviews TO fieldline_app, fieldline_platform;
