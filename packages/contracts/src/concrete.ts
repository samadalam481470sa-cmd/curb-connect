// Concrete dispatch contracts (blueprint gap 5): mix designs, orders, load
// tickets, dispatch board, and the delivered-yards invoice handoff. Money is
// integer minor units; yardages are numbers.
import { z } from 'zod';
import { UuidSchema } from './common';

export const ConcreteStatusSchema = z.enum([
  'scheduled',
  'batched',
  'en_route',
  'on_site',
  'pouring',
  'complete',
  'cancelled',
]);

export const MixDesignSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  strength: z.string().nullable(),
  slump: z.string().nullable(),
  aggregate: z.string().nullable(),
  admixtures: z.string().nullable(),
  pricePerYardMinor: z.number().int().nullable(),
  active: z.boolean(),
  revision: z.number().int(),
});
export type MixDesign = z.infer<typeof MixDesignSchema>;

export const CreateMixDesignRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  strength: z.string().trim().max(60).nullable().optional(),
  slump: z.string().trim().max(60).nullable().optional(),
  aggregate: z.string().trim().max(120).nullable().optional(),
  admixtures: z.string().trim().max(300).nullable().optional(),
  pricePerYardMinor: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
});

export const UpdateMixDesignRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  strength: z.string().trim().max(60).nullable().optional(),
  slump: z.string().trim().max(60).nullable().optional(),
  aggregate: z.string().trim().max(120).nullable().optional(),
  admixtures: z.string().trim().max(300).nullable().optional(),
  pricePerYardMinor: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  active: z.boolean().optional(),
});

export const PhotoRefSchema = z.object({
  label: z.string().trim().max(120).default(''),
  reference: z.string().trim().min(1).max(500),
});

export const LoadSchema = z.object({
  id: UuidSchema,
  orderId: UuidSchema,
  truckAssetId: UuidSchema.nullable(),
  truckName: z.string().nullable(),
  driverName: z.string().nullable(),
  batchTime: z.string().nullable(),
  yardsLoaded: z.number().nullable(),
  yardsDelivered: z.number().nullable(),
  yardsReturned: z.number().nullable(),
  ticketNumber: z.string().nullable(),
  status: ConcreteStatusSchema,
  photoRefs: z.array(PhotoRefSchema),
  signatureName: z.string().nullable(),
  signedAt: z.string().nullable(),
  note: z.string().nullable(),
  revision: z.number().int(),
});
export type ConcreteLoad = z.infer<typeof LoadSchema>;

export const CreateLoadRequestSchema = z.object({
  truckAssetId: UuidSchema.nullable().optional(),
  driverName: z.string().trim().max(120).nullable().optional(),
  batchTime: z.iso.datetime().nullable().optional(),
  yardsLoaded: z.number().min(0).max(100000).nullable().optional(),
  ticketNumber: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

export const UpdateLoadRequestSchema = z.object({
  truckAssetId: UuidSchema.nullable().optional(),
  driverName: z.string().trim().max(120).nullable().optional(),
  batchTime: z.iso.datetime().nullable().optional(),
  yardsLoaded: z.number().min(0).max(100000).nullable().optional(),
  yardsDelivered: z.number().min(0).max(100000).nullable().optional(),
  yardsReturned: z.number().min(0).max(100000).nullable().optional(),
  ticketNumber: z.string().trim().max(60).nullable().optional(),
  photoRefs: z.array(PhotoRefSchema).max(50).optional(),
  signatureName: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

export const OrderTotalsSchema = z.object({
  loadCount: z.number().int(),
  completedLoads: z.number().int(),
  yardsLoaded: z.number(),
  yardsDelivered: z.number(),
  yardsReturned: z.number(),
  billableYards: z.number(),
  /** billableYards × entered price per yard; null when no price is entered. */
  billableAmountMinor: z.number().int().nullable(),
});

export const ConcreteOrderSchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema,
  jobNumber: z.string(),
  jobTitle: z.string(),
  mixDesignId: UuidSchema,
  mixName: z.string(),
  pourLocation: z.string(),
  volumeYards: z.number(),
  requestedOn: z.string(),
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  pumpNeeded: z.boolean(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  status: ConcreteStatusSchema,
  plantName: z.string().nullable(),
  truckAssetId: UuidSchema.nullable(),
  truckName: z.string().nullable(),
  driverName: z.string().nullable(),
  enteredEta: z.string().nullable(),
  invoiceId: UuidSchema.nullable(),
  invoiceNumber: z.string().nullable(),
  note: z.string().nullable(),
  loads: z.array(LoadSchema),
  totals: OrderTotalsSchema,
  revision: z.number().int(),
  createdAt: z.string(),
});
export type ConcreteOrder = z.infer<typeof ConcreteOrderSchema>;

export const CreateOrderRequestSchema = z.object({
  jobId: UuidSchema,
  mixDesignId: UuidSchema,
  pourLocation: z.string().trim().min(1).max(300),
  volumeYards: z.number().positive().max(100000),
  requestedOn: z.iso.date(),
  windowStart: z.string().trim().max(20).nullable().optional(),
  windowEnd: z.string().trim().max(20).nullable().optional(),
  pumpNeeded: z.boolean().default(false),
  contactName: z.string().trim().max(120).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  plantName: z.string().trim().max(120).nullable().optional(),
  truckAssetId: UuidSchema.nullable().optional(),
  driverName: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

export const UpdateOrderRequestSchema = z.object({
  pourLocation: z.string().trim().min(1).max(300).optional(),
  volumeYards: z.number().positive().max(100000).optional(),
  requestedOn: z.iso.date().optional(),
  windowStart: z.string().trim().max(20).nullable().optional(),
  windowEnd: z.string().trim().max(20).nullable().optional(),
  pumpNeeded: z.boolean().optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  plantName: z.string().trim().max(120).nullable().optional(),
  truckAssetId: UuidSchema.nullable().optional(),
  driverName: z.string().trim().max(120).nullable().optional(),
  enteredEta: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

export const SetStatusRequestSchema = z.object({
  status: ConcreteStatusSchema,
});

export const DispatchBoardResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.array(
    z.object({
      date: z.string(),
      orders: z.array(ConcreteOrderSchema),
    }),
  ),
});
export type DispatchBoardResponse = z.infer<typeof DispatchBoardResponseSchema>;

export const TruckOptionSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  kind: z.string(),
  identifier: z.string().nullable(),
  status: z.string(),
});
