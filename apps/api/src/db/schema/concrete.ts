// Tables owned by the `concrete` module (blueprint gap 5): mix designs
// (contractor-entered), concrete orders, and per-load tickets. Trucks come
// from the existing fleet registry (fleet_assets); drivers and plants are
// entered text. Status is advanced manually — there is no GPS/ETA provider,
// so ETA is an entered value, never faked live tracking. Signature on a load
// ticket is a typed-name attestation, same as change orders.
import { sql } from 'drizzle-orm';
import { boolean, date, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { minorUnits, rateColumn, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { invoices } from './invoices';
import { jobs } from './jobs';
import { fleetAssets } from './projectManagement';

const refs = (name: string) =>
  jsonb(name)
    .notNull()
    .default(sql`'[]'::jsonb`);

export const concreteMixDesigns = tenantTable(
  'concrete_mix_designs',
  {
    name: text('name').notNull(),
    /** Strength as entered (e.g. "4000 psi"). */
    strength: text('strength'),
    slump: text('slump'),
    aggregate: text('aggregate'),
    admixtures: text('admixtures'),
    /** Contractor-entered price per cubic yard, minor units. */
    pricePerYardMinor: minorUnits('price_per_yard_minor'),
    active: boolean('active').notNull().default(true),
    revision: revisionColumn(),
  },
  (t, h) => [h.uniq('orgId', 'name'), h.idx('orgId', 'active')],
);

export type ConcreteOrderStatus =
  | 'scheduled'
  | 'batched'
  | 'en_route'
  | 'on_site'
  | 'pouring'
  | 'complete'
  | 'cancelled';

export const concreteOrders = tenantTable(
  'concrete_orders',
  {
    jobId: uuid('job_id').notNull(),
    mixDesignId: uuid('mix_design_id').notNull(),
    pourLocation: text('pour_location').notNull(),
    volumeYards: rateColumn('volume_yards').notNull(),
    requestedOn: date('requested_on').notNull(),
    /** Requested window as entered text (e.g. "07:00"–"09:00"). */
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    pumpNeeded: boolean('pump_needed').notNull().default(false),
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    status: text('status').$type<ConcreteOrderStatus>().notNull().default('scheduled'),
    /** Plant name as entered (no plant registry exists). */
    plantName: text('plant_name'),
    /** Assigned truck from the fleet registry. */
    truckAssetId: uuid('truck_asset_id'),
    driverName: text('driver_name'),
    /** Manually entered ETA (no GPS provider connected). */
    enteredEta: text('entered_eta'),
    /** Draft invoice generated from delivered yards, when created. */
    invoiceId: uuid('invoice_id'),
    note: text('note'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('jobId', () => jobs),
    h.fk('mixDesignId', () => concreteMixDesigns),
    h.fk('truckAssetId', () => fleetAssets),
    h.fk('invoiceId', () => invoices),
    h.idx('orgId', 'requestedOn', 'status'),
    h.idx('orgId', 'jobId', 'status'),
  ],
);

export const concreteLoads = tenantTable(
  'concrete_loads',
  {
    orderId: uuid('order_id').notNull(),
    truckAssetId: uuid('truck_asset_id'),
    driverName: text('driver_name'),
    batchTime: tsColumn('batch_time'),
    yardsLoaded: rateColumn('yards_loaded'),
    yardsDelivered: rateColumn('yards_delivered'),
    yardsReturned: rateColumn('yards_returned'),
    /** Ticket number as entered from the paper/electronic ticket. */
    ticketNumber: text('ticket_number'),
    status: text('status')
      .$type<'scheduled' | 'batched' | 'en_route' | 'on_site' | 'pouring' | 'complete' | 'cancelled'>()
      .notNull()
      .default('scheduled'),
    /** [{label, reference}] photo references from the existing media/upload flow. */
    photoRefs: refs('photo_refs'),
    /** Typed-name attestation (same pattern as change orders; no e-sign provider). */
    signatureName: text('signature_name'),
    signedAt: tsColumn('signed_at'),
    note: text('note'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('orderId', () => concreteOrders, 'cascade'),
    h.fk('truckAssetId', () => fleetAssets),
    h.idx('orgId', 'orderId', 'status'),
  ],
);
