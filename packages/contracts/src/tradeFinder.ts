// Trade Finder contracts (blueprint gap 6): published directory profiles,
// the org's private vendor records, and unified search. Directory results
// show published data only (opted-in companies); vendor results are the
// org's own records and never leave the tenant.
import { z } from 'zod';
import { UuidSchema } from './common';

export const AvailabilitySchema = z.enum(['available', 'busy', 'not_taking_work']);
export const ExpiryStatusSchema = z.enum(['not_on_file', 'expired', 'expiring_soon', 'current']);

const stringList = z.array(z.string().trim().min(1).max(80)).max(100);

export const DirectoryProfileSchema = z.object({
  trades: z.array(z.string()),
  serviceCities: z.array(z.string()),
  serviceZips: z.array(z.string()),
  availability: AvailabilitySchema.nullable(),
  availabilityNote: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  licenseExpiresOn: z.string().nullable(),
  insuranceExpiresOn: z.string().nullable(),
  qualificationsNote: z.string().nullable(),
  directoryOptIn: z.boolean(),
  revision: z.number().int(),
});
export type DirectoryProfile = z.infer<typeof DirectoryProfileSchema>;

export const UpdateDirectoryProfileRequestSchema = z.object({
  trades: stringList.optional(),
  serviceCities: stringList.optional(),
  serviceZips: z.array(z.string().trim().regex(/^\d{5}$/, 'ZIP must be 5 digits')).max(200).optional(),
  availability: AvailabilitySchema.nullable().optional(),
  availabilityNote: z.string().trim().max(300).nullable().optional(),
  licenseNumber: z.string().trim().max(80).nullable().optional(),
  licenseExpiresOn: z.iso.date().nullable().optional(),
  insuranceExpiresOn: z.iso.date().nullable().optional(),
  qualificationsNote: z.string().trim().max(1000).nullable().optional(),
});

export const VendorProfileSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  trade: z.string().nullable(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  serviceCities: z.array(z.string()),
  serviceZips: z.array(z.string()),
  availability: AvailabilitySchema.nullable(),
  availabilityNote: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  licenseExpiresOn: z.string().nullable(),
  licenseStatus: ExpiryStatusSchema,
  insuranceExpiresOn: z.string().nullable(),
  insuranceStatus: ExpiryStatusSchema,
  qualificationsNote: z.string().nullable(),
  notes: z.string().nullable(),
  revision: z.number().int(),
});
export type VendorProfile = z.infer<typeof VendorProfileSchema>;

export const CreateVendorRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trade: z.string().trim().max(80).nullable().optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  contactEmail: z.string().trim().max(200).nullable().optional(),
  serviceCities: stringList.default([]),
  serviceZips: z.array(z.string().trim().regex(/^\d{5}$/, 'ZIP must be 5 digits')).max(200).default([]),
  availability: AvailabilitySchema.nullable().optional(),
  availabilityNote: z.string().trim().max(300).nullable().optional(),
  licenseNumber: z.string().trim().max(80).nullable().optional(),
  licenseExpiresOn: z.iso.date().nullable().optional(),
  insuranceExpiresOn: z.iso.date().nullable().optional(),
  qualificationsNote: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const UpdateVendorRequestSchema = CreateVendorRequestSchema.partial();

export const TradeSearchQuerySchema = z.object({
  trade: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  zip: z.string().trim().regex(/^\d{5}$/, 'ZIP must be 5 digits').optional(),
  zipArea: z.coerce.boolean().default(false),
  availability: AvailabilitySchema.optional(),
  qualifiedOnly: z.coerce.boolean().default(false),
  includeVendors: z.coerce.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const TradeSearchResultSchema = z.object({
  source: z.enum(['directory', 'vendor']),
  /** Directory: partner org id (for connection requests). Vendor: vendor profile id. */
  id: UuidSchema,
  name: z.string(),
  trades: z.array(z.string()),
  serviceCities: z.array(z.string()),
  serviceZips: z.array(z.string()),
  serviceAreaLabel: z.string().nullable(),
  availability: AvailabilitySchema.nullable(),
  availabilityNote: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  licenseExpiresOn: z.string().nullable(),
  licenseStatus: ExpiryStatusSchema,
  insuranceExpiresOn: z.string().nullable(),
  insuranceStatus: ExpiryStatusSchema,
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  connectionStatus: z.string().nullable(),
});
export type TradeSearchResult = z.infer<typeof TradeSearchResultSchema>;

export const TradeSearchResponseSchema = z.object({
  items: z.array(TradeSearchResultSchema),
  directoryCount: z.number().int(),
  vendorCount: z.number().int(),
});
