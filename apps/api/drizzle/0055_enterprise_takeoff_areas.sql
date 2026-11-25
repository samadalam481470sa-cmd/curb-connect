CREATE TABLE enterprise_suite.takeoff_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  calibration_id uuid NOT NULL,
  exterior jsonb NOT NULL CHECK (
    CASE WHEN jsonb_typeof(exterior) = 'array' THEN jsonb_array_length(exterior) BETWEEN 3 AND 150 ELSE false END
  ),
  holes jsonb NOT NULL CHECK (
    CASE WHEN jsonb_typeof(holes) = 'array' THEN jsonb_array_length(holes) <= 20 ELSE false END
  ),
  exterior_area double precision NOT NULL CHECK (exterior_area > 0 AND exterior_area < 'Infinity'::float8),
  deducted_area double precision NOT NULL CHECK (deducted_area >= 0 AND deducted_area < exterior_area),
  net_area double precision NOT NULL CHECK (net_area = exterior_area - deducted_area AND net_area > 0),
  exterior_perimeter double precision NOT NULL CHECK (exterior_perimeter > 0 AND exterior_perimeter < 'Infinity'::float8),
  deduction_perimeter double precision NOT NULL CHECK (deduction_perimeter >= 0 AND deduction_perimeter < 'Infinity'::float8),
  unit text NOT NULL CHECK (unit IN ('ft', 'in', 'yd', 'm', 'cm', 'mm')),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, plan_id, sheet_id, client_request_id),
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, calibration_id)
    REFERENCES enterprise_suite.takeoff_calibrations(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_takeoff_areas_sheet_idx
  ON enterprise_suite.takeoff_areas(org_id, project_id, plan_id, sheet_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_areas'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_areas TO fieldline_app, fieldline_platform;
