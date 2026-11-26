// Warranty & homeowner service contracts (builder operations section). A warranty ticket is a
// homeowner's claim against a completed job; staff triage it, open service work orders, and
// message the homeowner on the ticket thread. Homeowners reach their tickets through the same
// job-status link they already have (portal token, scope 'job') — no account needed. Statuses are
// plain workflow states; nothing here decides coverage — the builder does, and the ticket records
// what was decided, never an invented coverage answer.
import { z } from 'zod';
import { CurrencyCodeSchema, IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common';

export const WARRANTY_TICKET_STATUSES = [
  'new',
  'under_review',
  'approved',
  'denied',
  'in_progress',
  'completed',
  'closed',
] as const;
export const WarrantyTicketStatusSchema = z.enum(WARRANTY_TICKET_STATUSES);
export type WarrantyTicketStatus = z.infer<typeof WarrantyTicketStatusSchema>;

export const WARRANTY_WORK_ORDER_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export const WarrantyWorkOrderStatusSchema = z.enum(WARRANTY_WORK_ORDER_STATUSES);
export type WarrantyWorkOrderStatus = z.infer<typeof WarrantyWorkOrderStatusSchema>;

export const WarrantyTicketSchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema,
  customerId: UuidSchema.nullable(),
  title: z.string(),
  description: z.string(),
  status: WarrantyTicketStatusSchema,
  /** Who reported it: a staff member or the homeowner through the job-status link. */
  reportedBy: z.enum(['staff', 'homeowner']),
  coverageNote: z.string().nullable(),
  openedAt: IsoDateTimeSchema,
  closedAt: IsoDateTimeSchema.nullable(),
  revision: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type WarrantyTicket = z.infer<typeof WarrantyTicketSchema>;

export const WarrantyTicketListSchema = z.object({ items: z.array(WarrantyTicketSchema) });

export const CreateWarrantyTicketRequestSchema = z.object({
  jobId: UuidSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
});
export type CreateWarrantyTicketRequest = z.infer<typeof CreateWarrantyTicketRequestSchema>;

export const UpdateWarrantyTicketRequestSchema = z.object({
  status: WarrantyTicketStatusSchema.optional(),
  coverageNote: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateWarrantyTicketRequest = z.infer<typeof UpdateWarrantyTicketRequestSchema>;

export const WarrantyWorkOrderSchema = z.object({
  id: UuidSchema,
  ticketId: UuidSchema,
  title: z.string(),
  scope: z.string(),
  status: WarrantyWorkOrderStatusSchema,
  assigneeMembershipId: UuidSchema.nullable(),
  scheduledOn: IsoDateSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  /** Builder-entered cost of the service visit, when recorded. Never invented. */
  costMinor: z.number().int().nullable(),
  currency: CurrencyCodeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type WarrantyWorkOrder = z.infer<typeof WarrantyWorkOrderSchema>;

export const WarrantyWorkOrderListSchema = z.object({
  items: z.array(WarrantyWorkOrderSchema),
});

export const CreateWarrantyWorkOrderRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scope: z.string().trim().min(1).max(5000),
  assigneeMembershipId: UuidSchema.nullable().optional(),
  scheduledOn: IsoDateSchema.nullable().optional(),
  costMinor: z.number().int().min(0).nullable().optional(),
});
export type CreateWarrantyWorkOrderRequest = z.infer<typeof CreateWarrantyWorkOrderRequestSchema>;

export const UpdateWarrantyWorkOrderRequestSchema = z.object({
  status: WarrantyWorkOrderStatusSchema.optional(),
  scheduledOn: IsoDateSchema.nullable().optional(),
  assigneeMembershipId: UuidSchema.nullable().optional(),
  costMinor: z.number().int().min(0).nullable().optional(),
});
export type UpdateWarrantyWorkOrderRequest = z.infer<typeof UpdateWarrantyWorkOrderRequestSchema>;

export const WarrantyMessageSchema = z.object({
  id: UuidSchema,
  ticketId: UuidSchema,
  authorKind: z.enum(['staff', 'homeowner']),
  body: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type WarrantyMessage = z.infer<typeof WarrantyMessageSchema>;

export const WarrantyMessageListSchema = z.object({ items: z.array(WarrantyMessageSchema) });

export const CreateWarrantyMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
export type CreateWarrantyMessageRequest = z.infer<typeof CreateWarrantyMessageRequestSchema>;

// --------------------------------------------------------------- homeowner (portal token)

/** What the homeowner sees on the job-status link: their tickets for that job, no internals. */
export const PortalWarrantyTicketSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string(),
  status: WarrantyTicketStatusSchema,
  coverageNote: z.string().nullable(),
  openedAt: IsoDateTimeSchema,
  closedAt: IsoDateTimeSchema.nullable(),
  messages: z.array(WarrantyMessageSchema),
});
export type PortalWarrantyTicket = z.infer<typeof PortalWarrantyTicketSchema>;

export const PortalWarrantyListSchema = z.object({
  items: z.array(PortalWarrantyTicketSchema),
});

export const PortalCreateWarrantyTicketRequestSchema = z.object({
  token: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
});
export type PortalCreateWarrantyTicketRequest = z.infer<
  typeof PortalCreateWarrantyTicketRequestSchema
>;

export const PortalWarrantyMessageRequestSchema = z.object({
  token: z.string().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});
export type PortalWarrantyMessageRequest = z.infer<typeof PortalWarrantyMessageRequestSchema>;

export const PortalTokenRequestSchema = z.object({ token: z.string().min(1).max(200) });
