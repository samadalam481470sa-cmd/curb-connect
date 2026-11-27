// Tables owned by the `portalCapture` module (Renditions-style external-order
// gathering: orders from builders who are NOT on Field Pro, captured from
// their portals into one format):
//   * portal_connections — one builder-portal account per row. The portal
//     secret is stored ONLY as AES-256-GCM sealed text (secret_sealed,
//     encrypted with STORAGE_ENCRYPTION_KEY) and is never returned by any
//     API. Status is the honest result of the last capture attempt.
//   * portal_capture_runs — one row per capture attempt (manual or
//     scheduled): counts found/new/revised, per-order errors, and an honest
//     'no_adapters' result when no adapter is registered for the portal.
//   * external_orders — captured orders normalized into Field Pro lines.
//     Dedupe key (org, connection, builder PO number): a re-capture updates
//     the same row as a revision, never a duplicate. Conversion creates ONE
//     draft supplier order (converted_order_id unique per org), confirmed by
//     a human — captured orders never auto-commit money.
import { sql } from 'drizzle-orm';
import { integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { minorUnits, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { supplierOrders } from './jobs';

export type PortalConnectionStatus =
  | 'not_connected'
  | 'connected'
  | 'login_failed'
  | 'portal_changed'
  | 'blocked';

export const portalConnections = tenantTable(
  'portal_connections',
  {
    /** Stable adapter key for the builder portal (e.g. 'acme-builder-portal'). */
    portalKey: text('portal_key').notNull(),
    portalName: text('portal_name').notNull(),
    /** The supplier's own login identifier on that portal (username/email). */
    loginIdentifier: text('login_identifier').notNull(),
    /**
     * The supplier's own portal secret, AES-256-GCM sealed (base64url of
     * iv+tag+body, key = STORAGE_ENCRYPTION_KEY). Write-only: no API returns
     * it, and it is never logged. Plain authorized login only — no anti-bot
     * evasion is built or permitted (see docs/renditions-capture.md).
     */
    secretSealed: text('secret_sealed').notNull(),
    status: text('status').$type<PortalConnectionStatus>().notNull().default('not_connected'),
    lastCheckedAt: tsColumn('last_checked_at'),
    lastError: text('last_error'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.uniq('orgId', 'portalKey', 'loginIdentifier'),
    h.idx('orgId', 'status'),
  ],
);

export type CaptureRunStatus = 'running' | 'succeeded' | 'failed' | 'no_adapters';

export const portalCaptureRuns = tenantTable(
  'portal_capture_runs',
  {
    connectionId: uuid('connection_id').notNull(),
    trigger: text('trigger').$type<'manual' | 'scheduled'>().notNull(),
    status: text('status').$type<CaptureRunStatus>().notNull().default('running'),
    startedAt: tsColumn('started_at').notNull().defaultNow(),
    finishedAt: tsColumn('finished_at'),
    ordersFound: integer('orders_found').notNull().default(0),
    ordersNew: integer('orders_new').notNull().default(0),
    ordersRevised: integer('orders_revised').notNull().default(0),
    /** Per-order capture errors: [{ orderRef?, message }]. Never contains secrets. */
    errors: jsonb('errors')
      .notNull()
      .default(sql`'[]'::jsonb`),
    note: text('note'),
  },
  (_t, h) => [
    h.fk('connectionId', () => portalConnections, 'cascade'),
    h.idx('orgId', 'connectionId', 'createdAt'),
    h.idx('orgId', 'status'),
  ],
);

export const externalOrders = tenantTable(
  'external_orders',
  {
    connectionId: uuid('connection_id').notNull(),
    builderName: text('builder_name').notNull(),
    builderPoNumber: text('builder_po_number').notNull(),
    /** Order date as normalized by the adapter (ISO date text), when published. */
    orderedOn: text('ordered_on'),
    /** The raw captured payload exactly as the adapter returned it (audit trail). */
    capturedPayload: jsonb('captured_payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /**
     * Normalized lines: [{ label, quantity, unit, unitPriceMinor,
     * supplierSku, mappingStatus }]. supplierSku is set only on an exact
     * SKU-mapping match; unmapped lines stay flagged, never guessed.
     */
    lines: jsonb('lines')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Sum of priced lines only (integer minor units); null when unpriced. */
    totalMinor: minorUnits('total_minor'),
    status: text('status').$type<'captured' | 'converted'>().notNull().default('captured'),
    /** Re-captures of the same builder PO update this row and bump this count. */
    revisionCount: integer('revision_count').notNull().default(0),
    lastCapturedAt: tsColumn('last_captured_at').notNull().defaultNow(),
    convertedOrderId: uuid('converted_order_id'),
    note: text('note'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('connectionId', () => portalConnections, 'cascade'),
    h.fk('convertedOrderId', () => supplierOrders),
    h.uniq('orgId', 'connectionId', 'builderPoNumber'),
    h.uniq('orgId', 'convertedOrderId'),
    h.idx('orgId', 'status'),
    h.idx('orgId', 'builderName'),
  ],
);
