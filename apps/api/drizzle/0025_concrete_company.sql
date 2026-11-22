-- Concrete Company: separate, tenant-isolated ready-mix operations workspace.
-- This migration is additive. It does not alter existing Curb Connect tables or customer records.
CREATE SCHEMA IF NOT EXISTS concrete_company;
--> statement-breakpoint
CREATE TABLE concrete_company.settings (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  company_name varchar(180) NOT NULL DEFAULT '',
  timezone varchar(80) NOT NULL DEFAULT 'America/Chicago',
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE concrete_company.plants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  code varchar(40) NOT NULL,
  name varchar(180) NOT NULL CHECK (length(trim(name)) > 0),
  address varchar(300) NOT NULL DEFAULT '',
  city varchar(100) NOT NULL DEFAULT '',
  region varchar(80) NOT NULL DEFAULT '',
  latitude double precision,
  longitude double precision,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_plants_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT cc_plants_org_code_uq UNIQUE (org_id,code)
);
--> statement-breakpoint
CREATE INDEX cc_plants_org_updated_idx ON concrete_company.plants(org_id,updated_at DESC);
--> statement-breakpoint
CREATE TABLE concrete_company.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  employee_code varchar(40) NOT NULL,
  display_name varchar(180) NOT NULL CHECK (length(trim(display_name)) > 0),
  phone varchar(40),
  email varchar(254),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  external_driver_id varchar(160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_drivers_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT cc_drivers_org_employee_uq UNIQUE (org_id,employee_code)
);
--> statement-breakpoint
CREATE INDEX cc_drivers_org_status_idx ON concrete_company.drivers(org_id,status);
--> statement-breakpoint
CREATE TABLE concrete_company.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  plant_id uuid,
  current_driver_id uuid,
  vehicle_number varchar(40) NOT NULL,
  vin varchar(40),
  make varchar(100),
  model varchar(100),
  model_year integer CHECK (model_year IS NULL OR model_year BETWEEN 1950 AND 2100),
  license_plate varchar(30),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','maintenance')),
  telematics_provider varchar(40) NOT NULL DEFAULT 'manual',
  external_vehicle_id varchar(180),
  last_latitude double precision,
  last_longitude double precision,
  last_heading double precision,
  last_speed_mph numeric(8,2),
  last_seen_at timestamptz,
  engine_state varchar(20),
  engine_rpm integer,
  engine_hours numeric(12,2),
  odometer_miles numeric(12,2),
  fuel_percent numeric(6,2) CHECK (fuel_percent IS NULL OR fuel_percent BETWEEN 0 AND 100),
  engine_fault_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  drum_rpm integer,
  drum_direction varchar(20),
  water_added_gallons numeric(10,2),
  concrete_temp_f numeric(7,2),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_vehicles_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT cc_vehicles_org_number_uq UNIQUE (org_id,vehicle_number),
  CONSTRAINT cc_vehicles_plant_fk FOREIGN KEY (org_id,plant_id) REFERENCES concrete_company.plants(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT cc_vehicles_driver_fk FOREIGN KEY (org_id,current_driver_id) REFERENCES concrete_company.drivers(org_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX cc_vehicles_org_provider_external_uq ON concrete_company.vehicles(org_id,telematics_provider,external_vehicle_id);
--> statement-breakpoint
CREATE INDEX cc_vehicles_org_status_idx ON concrete_company.vehicles(org_id,status);
--> statement-breakpoint
CREATE INDEX cc_vehicles_org_seen_idx ON concrete_company.vehicles(org_id,last_seen_at DESC);
--> statement-breakpoint
CREATE TABLE concrete_company.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  plant_id uuid NOT NULL,
  vehicle_id uuid,
  driver_id uuid,
  ticket_number varchar(80) NOT NULL,
  customer_name varchar(180) NOT NULL DEFAULT '',
  job_name varchar(180) NOT NULL CHECK (length(trim(job_name)) > 0),
  job_address varchar(300) NOT NULL DEFAULT '',
  job_latitude double precision,
  job_longitude double precision,
  mix_code varchar(80) NOT NULL DEFAULT '',
  ordered_yards numeric(10,2) NOT NULL CHECK (ordered_yards > 0 AND ordered_yards <= 1000),
  loaded_yards numeric(10,2),
  delivered_yards numeric(10,2),
  status varchar(24) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','batched','loaded','dispatched','arrived','pouring','completed','cancelled')),
  scheduled_at timestamptz,
  loaded_at timestamptz,
  departed_at timestamptz,
  arrived_at timestamptz,
  pour_started_at timestamptz,
  pour_completed_at timestamptz,
  created_by_user_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_deliveries_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT cc_deliveries_org_ticket_uq UNIQUE (org_id,ticket_number),
  CONSTRAINT cc_deliveries_plant_fk FOREIGN KEY (org_id,plant_id) REFERENCES concrete_company.plants(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT cc_deliveries_vehicle_fk FOREIGN KEY (org_id,vehicle_id) REFERENCES concrete_company.vehicles(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT cc_deliveries_driver_fk FOREIGN KEY (org_id,driver_id) REFERENCES concrete_company.drivers(org_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX cc_deliveries_org_status_schedule_idx ON concrete_company.deliveries(org_id,status,scheduled_at);
--> statement-breakpoint
CREATE INDEX cc_deliveries_org_vehicle_idx ON concrete_company.deliveries(org_id,vehicle_id);
--> statement-breakpoint
CREATE TABLE concrete_company.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider varchar(40) NOT NULL,
  label varchar(120) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'setup_required',
  external_account_id varchar(180),
  credential_ciphertext text,
  credential_iv varchar(40),
  credential_tag varchar(40),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_error varchar(500),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_integrations_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT cc_integrations_org_provider_uq UNIQUE (org_id,provider),
  CONSTRAINT cc_integrations_provider_check CHECK (provider IN ('samsara','geotab','command_alkon','jonel','bcmi','giatec','custom_gateway'))
);
--> statement-breakpoint
CREATE TABLE concrete_company.telemetry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL,
  provider varchar(40) NOT NULL,
  external_event_id varchar(180) NOT NULL,
  event_type varchar(80) NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_telemetry_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT cc_telemetry_vehicle_fk FOREIGN KEY (org_id,vehicle_id) REFERENCES concrete_company.vehicles(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT cc_telemetry_org_provider_event_uq UNIQUE (org_id,provider,external_event_id)
);
--> statement-breakpoint
CREATE INDEX cc_telemetry_org_vehicle_time_idx ON concrete_company.telemetry_events(org_id,vehicle_id,occurred_at DESC);
--> statement-breakpoint
CREATE TABLE concrete_company.device_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL,
  label varchar(120) NOT NULL,
  key_prefix varchar(32) NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_device_keys_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT cc_device_keys_vehicle_fk FOREIGN KEY (org_id,vehicle_id) REFERENCES concrete_company.vehicles(org_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX cc_device_keys_org_vehicle_idx ON concrete_company.device_keys(org_id,vehicle_id);
--> statement-breakpoint
CREATE TABLE concrete_company.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  vehicle_id uuid,
  driver_id uuid,
  delivery_id uuid,
  alert_type varchar(60) NOT NULL,
  severity varchar(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  title varchar(180) NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid,
  CONSTRAINT cc_alerts_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT cc_alerts_vehicle_fk FOREIGN KEY (org_id,vehicle_id) REFERENCES concrete_company.vehicles(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT cc_alerts_driver_fk FOREIGN KEY (org_id,driver_id) REFERENCES concrete_company.drivers(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT cc_alerts_delivery_fk FOREIGN KEY (org_id,delivery_id) REFERENCES concrete_company.deliveries(org_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX cc_alerts_org_status_severity_idx ON concrete_company.alerts(org_id,status,severity);
--> statement-breakpoint
CREATE INDEX cc_alerts_org_detected_idx ON concrete_company.alerts(org_id,detected_at DESC);
--> statement-breakpoint
CREATE TABLE concrete_company.quality_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  delivery_id uuid NOT NULL,
  observation_type varchar(60) NOT NULL,
  measured_value numeric(12,3) NOT NULL,
  unit varchar(30) NOT NULL,
  result varchar(20) NOT NULL DEFAULT 'recorded' CHECK (result IN ('recorded','pass','warning','fail')),
  notes varchar(1000) NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL,
  recorded_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_quality_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT cc_quality_delivery_fk FOREIGN KEY (org_id,delivery_id) REFERENCES concrete_company.deliveries(org_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX cc_quality_org_delivery_idx ON concrete_company.quality_observations(org_id,delivery_id,observed_at DESC);
--> statement-breakpoint
CREATE TABLE concrete_company.maintenance_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL,
  work_order_number varchar(80) NOT NULL,
  category varchar(60) NOT NULL,
  priority varchar(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  description varchar(2000) NOT NULL,
  due_at timestamptz,
  completed_at timestamptz,
  external_work_order_id varchar(180),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_maintenance_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT cc_maintenance_vehicle_fk FOREIGN KEY (org_id,vehicle_id) REFERENCES concrete_company.vehicles(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT cc_maintenance_org_number_uq UNIQUE (org_id,work_order_number)
);
--> statement-breakpoint
CREATE INDEX cc_maintenance_org_vehicle_status_idx ON concrete_company.maintenance_work_orders(org_id,vehicle_id,status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.settings'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.plants'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.drivers'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.vehicles'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.deliveries'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.integrations'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.telemetry_events'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.device_keys'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.alerts'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.quality_observations'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('concrete_company.maintenance_work_orders'::regclass);
--> statement-breakpoint
GRANT USAGE ON SCHEMA concrete_company TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA concrete_company TO fieldline_app, fieldline_platform;
