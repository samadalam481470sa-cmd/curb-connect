// Tables owned by the `supplierFlow` module: purchase orders that flow between two Field Pro
// companies over an existing network connection (each company owns its mirrored row, written
// by the `network.order` platform operation after the connection is verified — the same
// pattern as network bills), SKU mappings (builder package name → supplier SKU), lite
// dispatch routes, and supplier field reports. Cross-company ids are plain uuid columns;
// nothing references another tenant's table.
import { sql } from 'drizzle-orm';
import { jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';

export const networkOrders = tenantTable(
  'network_orders',
  {
    orderKey: uuid('order_key').notNull(),
    side: text('side').$type<'buyer' | 'supplier'>().notNull(),
    partnerOrgId: uuid('partner_org_id').notNull(),
    partnerDisplayName: text('partner_display_name').notNull(),
    reference: text('reference').notNull(),
    status: text('status')
      .$type<'sent' | 'accepted' | 'declined' | 'in_production' | 'shipped' | 'delivered' | 'cancelled'>()
      .notNull()
      .default('sent'),
    lines: jsonb('lines')
      .notNull()
      .default(sql`'[]'::jsonb`),
    totalMinor: minorUnits('total_minor'),
    currency: currencyColumn(),
    requestedDeliveryOn: text('requested_delivery_on'),
    deliveryAddress: text('delivery_address'),
    note: text('note'),
    /** Status history: every transition with timestamp, actor side, and note. */
    history: jsonb('history')
      .notNull()
      .default(sql`'[]'::jsonb`),
    sentAt: tsColumn('sent_at').notNull().defaultNow(),
    respondedAt: tsColumn('responded_at'),
    /** Honest email state for the send-out: 'not_connected' until the mailer/SMTP exists. */
    emailState: text('email_state')
      .$type<'not_connected' | 'queued' | 'sent' | 'failed'>()
      .notNull()
      .default('not_connected'),
    emailSentAt: tsColumn('email_sent_at'),
    emailNote: text('email_note'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'orderKey'), h.idx('orgId', 'status'), h.idx('partnerOrgId', 'status')],
);

export const skuMappings = tenantTable(
  'sku_mappings',
  {
    partnerOrgId: uuid('partner_org_id'),
    packageName: text('package_name').notNull(),
    supplierSku: text('supplier_sku').notNull(),
    note: text('note'),
  },
  (_t, h) => [h.uniq('orgId', 'packageName'), h.idx('orgId', 'supplierSku')],
);

export const dispatchRoutes = tenantTable(
  'dispatch_routes',
  {
    routeDate: text('route_date').notNull(),
    driverName: text('driver_name'),
    status: text('status')
      .$type<'planned' | 'dispatched' | 'completed' | 'cancelled'>()
      .notNull()
      .default('planned'),
    stops: jsonb('stops')
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (_t, h) => [h.idx('orgId', 'routeDate')],
);

export const supplierFieldReports = tenantTable(
  'supplier_field_reports',
  {
    orderId: uuid('order_id'),
    reportKind: text('report_kind')
      .$type<'delivery' | 'site_condition' | 'damage' | 'other'>()
      .notNull(),
    note: text('note').notNull(),
    photoMediaIds: uuid('photo_media_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdByUserId: uuid('created_by_user_id'),
  },
  (_t, h) => [h.idx('orgId', 'createdAt'), h.idx('orderId')],
);
