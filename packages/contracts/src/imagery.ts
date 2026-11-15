// Imagery rights engine contracts (RF-022, RR-031, COS-202, ADD-020, ADD-022, ADD-035). Each use of
// an image (visualization, machine analysis/inference, caching, PDF embedding, redistribution) is
// decided independently from the license terms stored with the asset; a visualization-only map
// source can never feed inference, caches or exports.
import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common';
import * as E from './enums';

export const IMAGERY_USES = ['visualize', 'analyze', 'cache', 'embed_in_exports', 'redistribute'] as const;
export const ImageryUseSchema = z.enum(IMAGERY_USES);
export type ImageryUse = z.infer<typeof ImageryUseSchema>;

/** Rights stored in imagery_assets.rights (rights engine input). */
export const ImageryLicenseSchema = z.object({
  /** Schema version of this rights document. */
  rightsVersion: z.literal(1),
  visualize: z.boolean(),
  /** Machine analysis / inference / measurement derived from pixels. */
  analyze: z.boolean(),
  /** Store pixels or thumbnails beyond the viewing session. */
  cache: z.boolean(),
  embedInExports: z.boolean(),
  redistribute: z.boolean(),
  /** License expiry; every use is denied after it. null = no expiry stated. */
  expiresAt: IsoDateTimeSchema.nullable(),
  attributionRequired: z.boolean(),
  licenseRef: z.string().max(200).nullable(),
  /** Who asserted the rights (contractor uploads): rights are then the uploader's declaration. */
  assertedBy: z
    .object({ userId: UuidSchema, at: IsoDateTimeSchema, statement: z.string().max(2000) })
    .nullable()
    .default(null),
  /** Synthetic test imagery (fixture provider): never presented as a real capture. */
  isSynthetic: z.boolean().default(false),
});
export type ImageryLicense = z.infer<typeof ImageryLicenseSchema>;

export const RightsDecisionSchema = z.object({
  use: ImageryUseSchema,
  allowed: z.boolean(),
  /** Machine-readable reason (e.g. license_forbids_analyze, license_expired). */
  reason: z.string(),
});
export type RightsDecision = z.infer<typeof RightsDecisionSchema>;

export const ImageryAssetSchema = z.object({
  id: UuidSchema,
  propertyId: UuidSchema,
  provider: E.ImageryProviderSchema,
  providerImageId: z.string().nullable(),
  kind: E.ImageryKindSchema,
  status: E.ImageryStatusSchema,
  rights: ImageryLicenseSchema,
  decisions: z.array(RightsDecisionSchema),
  attribution: z.string(),
  gsdM: z.number().positive().nullable(),
  captureDate: IsoDateSchema.nullable(),
  /** Georeference (affine or control points); null = uncalibrated (never measure from pixels). */
  georef: z.record(z.string(), z.unknown()).nullable(),
  calibrated: z.boolean(),
  expiresAt: IsoDateTimeSchema.nullable(),
  isSynthetic: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
});
export type ImageryAsset = z.infer<typeof ImageryAssetSchema>;

export const ImagerySearchQuerySchema = z.object({
  propertyId: UuidSchema,
  /** Restrict to one provider; default all configured providers. */
  provider: E.ImageryProviderSchema.optional(),
});

/** Contractor-supplied imagery (drone photo, blueprint, site photo) with ASSERTED rights. */
export const ContractorImageryRequestSchema = z.object({
  propertyId: UuidSchema,
  kind: z.enum(['drone_photo', 'blueprint', 'site_photo', 'orthophoto']),
  mediaAssetId: UuidSchema.optional(),
  captureDate: IsoDateSchema.optional(),
  gsdM: z.number().positive().optional(),
  /** Without a georeference/scale the asset is uncalibrated and cannot back measurements. */
  georef: z.record(z.string(), z.unknown()).optional(),
  attribution: z.string().min(1).max(300),
  rights: z.object({
    analyze: z.boolean(),
    cache: z.boolean(),
    embedInExports: z.boolean(),
    redistribute: z.boolean().default(false),
    expiresAt: IsoDateTimeSchema.nullable().default(null),
    licenseRef: z.string().max(200).nullable().default(null),
  }),
  /** The uploader confirms they hold these rights (consent text is stored with the asset). */
  rightsStatement: z.string().min(10).max(2000),
});
