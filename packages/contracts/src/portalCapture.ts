// Portal Capture contracts: the Renditions-style external-order capture
// framework (Hyphen SupplyPro "Gather" equivalent — orders from builders who
// are NOT on Field Pro, gathered into one format). No live portal adapter
// ships with this framework: adapters are added per builder portal against a
// real, supplier-authorized account, using plain authorized login only — no
// anti-bot evasion (no CAPTCHA solving, no fingerprint spoofing, no stealth
// browser tricks). Captured orders never auto-commit money: conversion into
// the existing PO flow is a human-confirmed draft action. Money travels in
// integer minor units; unmapped lines stay unmapped and flagged, never
// guessed equivalent.
import { z } from 'zod';
import { UuidSchema } from './common';

/** Connection health, reported honestly by the last capture attempt. */
export const PortalConnectionStatusSchema = z.enum([
  'not_connected',
  'connected',
  'login_failed',
  'portal_changed',
  'blocked',
]);
export type PortalConnectionStatus = z.infer<typeof PortalConnectionStatusSchema>;

/**
 * A stored builder-portal connection. The portal secret is write-only: it is
 * accepted on create/update, encrypted at rest, and NEVER returned by any
 * API — `hasSecret` only says whether one is stored.
 */
export const PortalConnectionSchema = z.object({
  id: UuidSchema,
  portalKey: z.string(),
  portalName: z.string(),
  loginIdentifier: z.string(),
  hasSecret: z.boolean(),
  status: PortalConnectionStatusSchema,
  lastCheckedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  revision: z.number().int(),
  createdAt: z.string(),
});
export type PortalConnection = z.infer<typeof PortalConnectionSchema>;

export const CreatePortalConnectionRequestSchema = z.object({
  /** Stable adapter key for the builder portal (e.g. 'acme-builder-portal'). */
  portalKey: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use lowercase letters, numbers, dashes or underscores.'),
  portalName: z.string().trim().min(1).max(200),
  /** The supplier's own login identifier on that portal (username/email). */
  loginIdentifier: z.string().trim().min(1).max(320),
  /** The supplier's own portal secret. Stored encrypted; never returned. */
  secret: z.string().min(1).max(1000),
});

export const UpdatePortalConnectionRequestSchema = z.object({
  portalName: z.string().trim().min(1).max(200).optional(),
  loginIdentifier: z.string().trim().min(1).max(320).optional(),
  /** Provide to rotate the stored secret; omit to keep the current one. */
  secret: z.string().min(1).max(1000).optional(),
});

export const CaptureRunStatusSchema = z.enum(['running', 'succeeded', 'failed', 'no_adapters']);
export type CaptureRunStatus = z.infer<typeof CaptureRunStatusSchema>;

export const CaptureRunErrorSchema = z.object({
  /** Builder PO number the error belongs to, when it is order-scoped. */
  orderRef: z.string().nullable().optional(),
  message: z.string(),
});

export const CaptureRunSchema = z.object({
  id: UuidSchema,
  connectionId: UuidSchema,
  portalKey: z.string(),
  portalName: z.string(),
  trigger: z.enum(['manual', 'scheduled']),
  status: CaptureRunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  ordersFound: z.number().int(),
  ordersNew: z.number().int(),
  ordersRevised: z.number().int(),
  errors: z.array(CaptureRunErrorSchema),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type CaptureRun = z.infer<typeof CaptureRunSchema>;

/**
 * One normalized line of a captured external order. `supplierSku` is filled
 * only when the builder's item/package name matches an existing SKU mapping
 * exactly; otherwise the line stays `unmapped` and flagged for a human.
 */
export const ExternalOrderLineSchema = z.object({
  label: z.string(),
  quantity: z.number(),
  unit: z.string(),
  unitPriceMinor: z.number().int().nullable(),
  supplierSku: z.string().nullable(),
  mappingStatus: z.enum(['mapped', 'unmapped']),
});
export type ExternalOrderLine = z.infer<typeof ExternalOrderLineSchema>;

export const ExternalOrderStatusSchema = z.enum(['captured', 'converted']);

export const ExternalOrderSchema = z.object({
  id: UuidSchema,
  connectionId: UuidSchema,
  portalKey: z.string(),
  builderName: z.string(),
  builderPoNumber: z.string(),
  orderedOn: z.string().nullable(),
  lines: z.array(ExternalOrderLineSchema),
  /** Sum of priced lines only; null when no line carries a price. */
  totalMinor: z.number().int().nullable(),
  mappedLineCount: z.number().int(),
  unmappedLineCount: z.number().int(),
  /** How many times this order was re-captured as a revision (0 = first capture). */
  revisionCount: z.number().int(),
  lastCapturedAt: z.string(),
  status: ExternalOrderStatusSchema,
  convertedOrderId: UuidSchema.nullable(),
  note: z.string().nullable(),
  revision: z.number().int(),
  createdAt: z.string(),
});
export type ExternalOrder = z.infer<typeof ExternalOrderSchema>;

/**
 * Human-confirmed conversion into a draft supplier order (PO) in the existing
 * flow. Idempotent: converting twice returns the same draft — never two POs.
 */
export const ConvertExternalOrderRequestSchema = z.object({
  jobId: UuidSchema,
  /** Draft PO reference; defaults to the builder PO number. */
  reference: z.string().trim().max(200).nullable().optional(),
});

/** Framework status for honest empty states in the UI. */
export const PortalCaptureStatusSchema = z.object({
  /** False when STORAGE_ENCRYPTION_KEY is not configured: secrets cannot be stored. */
  vaultConfigured: z.boolean(),
  /** Registered live adapters. Empty until one is built per real builder portal. */
  adapters: z.array(z.object({ portalKey: z.string(), portalName: z.string() })),
  note: z.string(),
});
export type PortalCaptureStatus = z.infer<typeof PortalCaptureStatusSchema>;
