// Supplier order flow contracts (builder operations section). Orders flow between two Field Pro
// companies over an existing network connection: the buyer sends an order, the supplier accepts
// or declines, and both sides track status on their own mirrored row (the same pattern as
// network bills — each company owns its row; a named platform operation writes the mirror).
// This only works when BOTH companies are on Field Pro and connected; the UI says so plainly.
// SKU mapping translates a builder's package name into the supplier's SKU (builder-entered).
// Dispatch is a lite route plan (ordered stops on a date), not turn-by-turn routing.
import { z } from 'zod';
import { CurrencyCodeSchema, IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common';

export const NETWORK_ORDER_STATUSES = [
  'sent',
  'accepted',
  'declined',
  'in_production',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export const NetworkOrderStatusSchema = z.enum(NETWORK_ORDER_STATUSES);
export type NetworkOrderStatus = z.infer<typeof NetworkOrderStatusSchema>;

export const NetworkOrderLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().min(0).max(1_000_000),
  unit: z.string().trim().max(30).nullable().optional(),
  /** Builder-entered unit price; null means "price to be quoted by the supplier". */
  unitPriceMinor: z.number().int().min(0).nullable().optional(),
  /** Builder package name, translated through SKU mapping on the supplier side. */
  packageName: z.string().trim().max(200).nullable().optional(),
});
export type NetworkOrderLine = z.infer<typeof NetworkOrderLineSchema>;

export const NetworkOrderHistoryEntrySchema = z.object({
  status: NetworkOrderStatusSchema,
  at: IsoDateTimeSchema,
  bySide: z.enum(['buyer', 'supplier']),
  note: z.string().nullable(),
});
export type NetworkOrderHistoryEntry = z.infer<typeof NetworkOrderHistoryEntrySchema>;

export const NetworkOrderSchema = z.object({
  id: UuidSchema,
  orderKey: UuidSchema,
  /** 'buyer' = we sent it; 'supplier' = it was sent to us. */
  side: z.enum(['buyer', 'supplier']),
  partnerOrgId: UuidSchema,
  partnerDisplayName: z.string(),
  reference: z.string(),
  status: NetworkOrderStatusSchema,
  lines: z.array(NetworkOrderLineSchema),
  totalMinor: z.number().int().nullable(),
  currency: CurrencyCodeSchema,
  requestedDeliveryOn: IsoDateSchema.nullable(),
  deliveryAddress: z.string().nullable(),
  note: z.string().nullable(),
  /** Every status transition, oldest first — the readable order history. */
  history: z.array(NetworkOrderHistoryEntrySchema),
  sentAt: IsoDateTimeSchema,
  respondedAt: IsoDateTimeSchema.nullable(),
  /** Honest email state: 'not_connected' means no mailer/SMTP is set up — nothing was emailed. */
  emailState: z.enum(['not_connected', 'queued', 'sent', 'failed']),
  emailSentAt: IsoDateTimeSchema.nullable(),
  emailNote: z.string().nullable(),
  revision: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type NetworkOrder = z.infer<typeof NetworkOrderSchema>;

export const NetworkOrderListSchema = z.object({ items: z.array(NetworkOrderSchema) });

export const SendNetworkOrderRequestSchema = z.object({
  partnerOrgId: UuidSchema,
  reference: z.string().trim().min(1).max(80),
  lines: z.array(NetworkOrderLineSchema).min(1).max(200),
  requestedDeliveryOn: IsoDateSchema.nullable().optional(),
  deliveryAddress: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type SendNetworkOrderRequest = z.infer<typeof SendNetworkOrderRequestSchema>;

export const DecideNetworkOrderRequestSchema = z.object({
  decision: z.enum(['accept', 'decline', 'start_production', 'ship', 'deliver', 'cancel']),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type DecideNetworkOrderRequest = z.infer<typeof DecideNetworkOrderRequestSchema>;

// ---------------------------------------------------------------- SKU mapping

export const SkuMappingSchema = z.object({
  id: UuidSchema,
  partnerOrgId: UuidSchema.nullable(),
  packageName: z.string(),
  supplierSku: z.string(),
  note: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SkuMapping = z.infer<typeof SkuMappingSchema>;

export const SkuMappingListSchema = z.object({ items: z.array(SkuMappingSchema) });

export const CreateSkuMappingRequestSchema = z.object({
  packageName: z.string().trim().min(1).max(200),
  supplierSku: z.string().trim().min(1).max(120),
  partnerOrgId: UuidSchema.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type CreateSkuMappingRequest = z.infer<typeof CreateSkuMappingRequestSchema>;

// ---------------------------------------------------------------- dispatch (lite)

export const DispatchRouteSchema = z.object({
  id: UuidSchema,
  routeDate: IsoDateSchema,
  driverName: z.string().nullable(),
  status: z.enum(['planned', 'dispatched', 'completed', 'cancelled']),
  /** Ordered stops; each names the order (when it is a network order) and address. */
  stops: z.array(
    z.object({
      orderId: UuidSchema.nullable(),
      address: z.string(),
      note: z.string().nullable().optional(),
    }),
  ),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type DispatchRoute = z.infer<typeof DispatchRouteSchema>;

export const DispatchRouteListSchema = z.object({ items: z.array(DispatchRouteSchema) });

export const CreateDispatchRouteRequestSchema = z.object({
  routeDate: IsoDateSchema,
  driverName: z.string().trim().max(160).nullable().optional(),
  stops: z
    .array(
      z.object({
        orderId: UuidSchema.nullable().optional(),
        address: z.string().trim().min(1).max(500),
        note: z.string().trim().max(1000).nullable().optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type CreateDispatchRouteRequest = z.infer<typeof CreateDispatchRouteRequestSchema>;

export const UpdateDispatchRouteRequestSchema = z.object({
  status: z.enum(['planned', 'dispatched', 'completed', 'cancelled']),
});
export type UpdateDispatchRouteRequest = z.infer<typeof UpdateDispatchRouteRequestSchema>;

// ---------------------------------------------------------------- supplier field reports

export const SupplierFieldReportSchema = z.object({
  id: UuidSchema,
  orderId: UuidSchema.nullable(),
  reportKind: z.enum(['delivery', 'site_condition', 'damage', 'other']),
  note: z.string(),
  /** Media ids of site photos already uploaded through the media module. */
  photoMediaIds: z.array(UuidSchema),
  createdByUserId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type SupplierFieldReport = z.infer<typeof SupplierFieldReportSchema>;

export const SupplierFieldReportListSchema = z.object({
  items: z.array(SupplierFieldReportSchema),
});

export const CreateSupplierFieldReportRequestSchema = z.object({
  orderId: UuidSchema.nullable().optional(),
  reportKind: z.enum(['delivery', 'site_condition', 'damage', 'other']),
  note: z.string().trim().min(1).max(5000),
  photoMediaIds: z.array(UuidSchema).max(50).default([]),
});
export type CreateSupplierFieldReportRequest = z.infer<
  typeof CreateSupplierFieldReportRequestSchema
>;
