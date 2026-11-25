ALTER TABLE enterprise_suite.takeoff_lengths
  ADD CONSTRAINT enterprise_takeoff_length_identity UNIQUE (org_id, project_id, plan_id, sheet_id, id);
--> statement-breakpoint
ALTER TABLE enterprise_suite.takeoff_areas
  ADD CONSTRAINT enterprise_takeoff_area_identity UNIQUE (org_id, project_id, plan_id, sheet_id, id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.takeoff_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('floor', 'room', 'material', 'phase', 'trade', 'alternate')),
  name varchar(100) NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 100),
  name_key text GENERATED ALWAYS AS (lower(trim(name))) STORED,
  parent_floor_id uuid,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'room') = (parent_floor_id IS NOT NULL)),
  UNIQUE (org_id, project_id, id),
  UNIQUE NULLS NOT DISTINCT (org_id, project_id, kind, parent_floor_id, name_key),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, parent_floor_id)
    REFERENCES enterprise_suite.takeoff_conditions(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.takeoff_condition_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  length_id uuid,
  area_id uuid,
  count_id uuid,
  measurement_id uuid GENERATED ALWAYS AS (coalesce(length_id, area_id, count_id)) STORED,
  measurement_kind text GENERATED ALWAYS AS (
    CASE WHEN length_id IS NOT NULL THEN 'length' WHEN area_id IS NOT NULL THEN 'area' ELSE 'count' END
  ) STORED,
  condition_id uuid NOT NULL,
  floor_id uuid,
  room_id uuid,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(length_id, area_id, count_id) = 1),
  CHECK (room_id IS NULL OR floor_id IS NOT NULL),
  UNIQUE (org_id, project_id, plan_id, sheet_id, measurement_kind, measurement_id, condition_id),
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, length_id)
    REFERENCES enterprise_suite.takeoff_lengths(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, area_id)
    REFERENCES enterprise_suite.takeoff_areas(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, count_id)
    REFERENCES enterprise_suite.takeoff_count_sets(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, condition_id)
    REFERENCES enterprise_suite.takeoff_conditions(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, floor_id)
    REFERENCES enterprise_suite.takeoff_conditions(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, room_id)
    REFERENCES enterprise_suite.takeoff_conditions(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_takeoff_assignment_sheet_idx
  ON enterprise_suite.takeoff_condition_assignments(org_id, project_id, plan_id, sheet_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX enterprise_takeoff_assignment_floor_idx
  ON enterprise_suite.takeoff_condition_assignments(org_id, project_id, floor_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_conditions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_condition_assignments'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_conditions, enterprise_suite.takeoff_condition_assignments
  TO fieldline_app, fieldline_platform;
