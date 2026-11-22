// Concrete Company is an additive, tenant-isolated ready-mix operations workspace.
import {
  pgSchema, uuid, varchar, text, integer, boolean, timestamp, numeric,
  doublePrecision, jsonb, index, uniqueIndex, unique,
} from 'drizzle-orm/pg-core';

const concrete = pgSchema('concrete_company');
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const concreteCompanySettings = concrete.table('settings', {
  orgId: uuid('org_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  companyName: varchar('company_name', { length: 180 }).notNull().default(''),
  timezone: varchar('timezone', { length: 80 }).notNull().default('America/Chicago'),
  updatedByUserId: uuid('updated_by_user_id'),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
});

export const concretePlants = concrete.table('plants', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  code: varchar('code', { length: 40 }).notNull(),
  name: varchar('name', { length: 180 }).notNull(),
  address: varchar('address', { length: 300 }).notNull().default(''),
  city: varchar('city', { length: 100 }).notNull().default(''),
  region: varchar('region', { length: 80 }).notNull().default(''),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
}, (t) => [
  unique('cc_plants_org_id_id_uq').on(t.orgId, t.id),
  uniqueIndex('cc_plants_org_code_uq').on(t.orgId, t.code),
  index('cc_plants_org_updated_idx').on(t.orgId, t.updatedAt),
]);

export const concreteDrivers = concrete.table('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  employeeCode: varchar('employee_code', { length: 40 }).notNull(),
  displayName: varchar('display_name', { length: 180 }).notNull(),
  phone: varchar('phone', { length: 40 }),
  email: varchar('email', { length: 254 }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  externalDriverId: varchar('external_driver_id', { length: 160 }),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
}, (t) => [
  unique('cc_drivers_org_id_id_uq').on(t.orgId, t.id),
  uniqueIndex('cc_drivers_org_employee_uq').on(t.orgId, t.employeeCode),
  index('cc_drivers_org_status_idx').on(t.orgId, t.status),
]);

export const concreteVehicles = concrete.table('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  plantId: uuid('plant_id'),
  currentDriverId: uuid('current_driver_id'),
  vehicleNumber: varchar('vehicle_number', { length: 40 }).notNull(),
  vin: varchar('vin', { length: 40 }),
  make: varchar('make', { length: 100 }),
  model: varchar('model', { length: 100 }),
  modelYear: integer('model_year'),
  licensePlate: varchar('license_plate', { length: 30 }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  telematicsProvider: varchar('telematics_provider', { length: 40 }).notNull().default('manual'),
  externalVehicleId: varchar('external_vehicle_id', { length: 180 }),
  lastLatitude: doublePrecision('last_latitude'),
  lastLongitude: doublePrecision('last_longitude'),
  lastHeading: doublePrecision('last_heading'),
  lastSpeedMph: numeric('last_speed_mph', { precision: 8, scale: 2 }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
  engineRpm: integer('engine_rpm'),
  engineHours: numeric('engine_hours', { precision: 12, scale: 2 }),
  odometerMiles: numeric('odometer_miles', { precision: 12, scale: 2 }),
  fuelPercent: numeric('fuel_percent', { precision: 6, scale: 2 }),
  engineFaultCodes: jsonb('engine_fault_codes').notNull().default([]),
  drumRpm: integer('drum_rpm'),
  drumDirection: varchar('drum_direction', { length: 20 }),
  waterAddedGallons: numeric('water_added_gallons', { precision: 10, scale: 2 }),
  concreteTempF: numeric('concrete_temp_f', { precision: 7, scale: 2 }),
  revision: integer('revision').notNull().default(1),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
}, (t) => [
  unique('cc_vehicles_org_id_id_uq').on(t.orgId, t.id),
  uniqueIndex('cc_vehicles_org_number_uq').on(t.orgId, t.vehicleNumber),
  uniqueIndex('cc_vehicles_org_provider_external_uq').on(t.orgId, t.telematicsProvider, t.externalVehicleId),
  index('cc_vehicles_org_status_idx').on(t.orgId, t.status),
  index('cc_vehicles_org_seen_idx').on(t.orgId, t.lastSeenAt),
]);

export const concreteDeliveries = concrete.table('deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  plantId: uuid('plant_id').notNull(),
  vehicleId: uuid('vehicle_id'),
  driverId: uuid('driver_id'),
  ticketNumber: varchar('ticket_number', { length: 80 }).notNull(),
  customerName: varchar('customer_name', { length: 180 }).notNull().default(''),
  jobName: varchar('job_name', { length: 180 }).notNull(),
  jobAddress: varchar('job_address', { length: 300 }).notNull().default(''),
  jobLatitude: doublePrecision('job_latitude'),
  jobLongitude: doublePrecision('job_longitude'),
  mixCode: varchar('mix_code', { length: 80 }).notNull().default(''),
  orderedYards: numeric('ordered_yards', { precision: 10, scale: 2 }).notNull(),
  loadedYards: numeric('loaded_yards', { precision: 10, scale: 2 }),
  deliveredYards: numeric('delivered_yards', { precision: 10, scale: 2 }),
  status: varchar('status', { length: 24 }).notNull().default('scheduled'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'date' }),
  loadedAt: timestamp('loaded_at', { withTimezone: true, mode: 'date' }),
  departedAt: timestamp('departed_at', { withTimezone: true, mode: 'date' }),
  arrivedAt: timestamp('arrived_at', { withTimezone: true, mode: 'date' }),
  pourStartedAt: timestamp('pour_started_at', { withTimezone: true, mode: 'date' }),
  pourCompletedAt: timestamp('pour_completed_at', { withTimezone: true, mode: 'date' }),
  createdByUserId: uuid('created_by_user_id').notNull(),
  revision: integer('revision').notNull().default(1),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
}, (t) => [
  unique('cc_deliveries_org_id_id_uq').on(t.orgId, t.id),
  uniqueIndex('cc_deliveries_org_ticket_uq').on(t.orgId, t.ticketNumber),
  index('cc_deliveries_org_status_schedule_idx').on(t.orgId, t.status, t.scheduledAt),
  index('cc_deliveries_org_vehicle_idx').on(t.orgId, t.vehicleId),
]);

export const concreteIntegrations = concrete.table('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  provider: varchar('provider', { length: 40 }).notNull(),
  label: varchar('label', { length: 120 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('setup_required'),
  externalAccountId: varchar('external_account_id', { length: 180 }),
  credentialCiphertext: text('credential_ciphertext'),
  credentialIv: varchar('credential_iv', { length: 40 }),
  credentialTag: varchar('credential_tag', { length: 40 }),
  config: jsonb('config').notNull().default({}),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
  lastError: varchar('last_error', { length: 500 }),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
}, (t) => [
  unique('cc_integrations_org_id_id_uq').on(t.orgId, t.id),
  uniqueIndex('cc_integrations_org_provider_uq').on(t.orgId, t.provider),
]);

export const concreteTelemetryEvents = concrete.table('telemetry_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  vehicleId: uuid('vehicle_id').notNull(),
  provider: varchar('provider', { length: 40 }).notNull(),
  externalEventId: varchar('external_event_id', { length: 180 }).notNull(),
  eventType: varchar('event_type', { length: 80 }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: instant('received_at'),
}, (t) => [
  unique('cc_telemetry_org_id_id_uq').on(t.orgId, t.id),
  uniqueIndex('cc_telemetry_org_provider_event_uq').on(t.orgId, t.provider, t.externalEventId),
  index('cc_telemetry_org_vehicle_time_idx').on(t.orgId, t.vehicleId, t.occurredAt),
]);

export const concreteDeviceKeys = concrete.table('device_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  vehicleId: uuid('vehicle_id').notNull(),
  label: varchar('label', { length: 120 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 32 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: instant('created_at'),
}, (t) => [
  unique('cc_device_keys_org_id_id_uq').on(t.orgId, t.id),
  uniqueIndex('cc_device_keys_token_hash_uq').on(t.tokenHash),
  index('cc_device_keys_org_vehicle_idx').on(t.orgId, t.vehicleId),
]);

export const concreteAlerts = concrete.table('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  vehicleId: uuid('vehicle_id'),
  driverId: uuid('driver_id'),
  deliveryId: uuid('delivery_id'),
  alertType: varchar('alert_type', { length: 60 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull().default('medium'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  title: varchar('title', { length: 180 }).notNull(),
  message: text('message').notNull(),
  details: jsonb('details').notNull().default({}),
  detectedAt: instant('detected_at'),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
  acknowledgedByUserId: uuid('acknowledged_by_user_id'),
}, (t) => [
  unique('cc_alerts_org_id_id_uq').on(t.orgId, t.id),
  index('cc_alerts_org_status_severity_idx').on(t.orgId, t.status, t.severity),
  index('cc_alerts_org_detected_idx').on(t.orgId, t.detectedAt),
]);

export const concreteQualityObservations = concrete.table('quality_observations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  deliveryId: uuid('delivery_id').notNull(),
  observationType: varchar('observation_type', { length: 60 }).notNull(),
  measuredValue: numeric('measured_value', { precision: 12, scale: 3 }).notNull(),
  unit: varchar('unit', { length: 30 }).notNull(),
  result: varchar('result', { length: 20 }).notNull().default('recorded'),
  notes: varchar('notes', { length: 1000 }).notNull().default(''),
  observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
  recordedByUserId: uuid('recorded_by_user_id').notNull(),
  createdAt: instant('created_at'),
}, (t) => [
  unique('cc_quality_org_id_id_uq').on(t.orgId, t.id),
  index('cc_quality_org_delivery_idx').on(t.orgId, t.deliveryId, t.observedAt),
]);

export const concreteMaintenanceWorkOrders = concrete.table('maintenance_work_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  vehicleId: uuid('vehicle_id').notNull(),
  workOrderNumber: varchar('work_order_number', { length: 80 }).notNull(),
  category: varchar('category', { length: 60 }).notNull(),
  priority: varchar('priority', { length: 20 }).notNull().default('normal'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  description: varchar('description', { length: 2000 }).notNull(),
  dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  externalWorkOrderId: varchar('external_work_order_id', { length: 180 }),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
}, (t) => [
  unique('cc_maintenance_org_id_id_uq').on(t.orgId, t.id),
  uniqueIndex('cc_maintenance_org_number_uq').on(t.orgId, t.workOrderNumber),
  index('cc_maintenance_org_vehicle_status_idx').on(t.orgId, t.vehicleId, t.status),
]);
