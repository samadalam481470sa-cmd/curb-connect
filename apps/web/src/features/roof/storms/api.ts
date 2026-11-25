// Shared contracts for the Hailstorm Map + Storm Response UI. These mirror the
// /v1/roof-storms API responses (apps/api/src/modules/roofStorms) and are validated
// with zod on every fetch, so a changed server shape fails loudly instead of
// rendering invented data.
import { z } from 'zod';

export const HailEventSchema = z.object({
  id: z.string(),
  date: z.string(),
  timeUtc: z.string(),
  magnitudeIn: z.number(),
  location: z.string(),
  county: z.string(),
  state: z.string(),
  lat: z.number(),
  lon: z.number(),
  comments: z.string(),
  source: z.string(),
});
export type HailEvent = z.infer<typeof HailEventSchema>;

export const HailFeedSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  source: z.string(),
  checkedAt: z.string(),
  daysRequested: z.number(),
  daysFetched: z.number(),
  daysFailed: z.number(),
  message: z.string(),
  events: z.array(HailEventSchema),
});
export type HailFeed = z.infer<typeof HailFeedSchema>;

export const MatchedAddressSchema = z.object({
  propertyId: z.string(),
  address: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  distanceMiles: z.number(),
  source: z.enum(['roof_job', 'crm_lead', 'property']),
  contact: z
    .object({
      id: z.string(),
      name: z.string(),
      phone: z.string().nullable(),
      smsOptedIn: z.boolean(),
    })
    .nullable(),
});
export type MatchedAddress = z.infer<typeof MatchedAddressSchema>;

export const ImpactSchema = z.object({
  event: HailEventSchema,
  radiusMiles: z.number(),
  source: z.string(),
  checkedAt: z.string(),
  matched: z.array(MatchedAddressSchema),
  matchedCount: z.number(),
  propertiesWithoutLocation: z.number(),
  revenueEstimateMinor: z.number().nullable(),
  averageJobValueMinor: z.number().nullable(),
  revenueLabel: z.string(),
  revenueNote: z.string(),
});
export type StormImpact = z.infer<typeof ImpactSchema>;

export const SmsStatusSchema = z.object({
  provider: z.string(),
  state: z.enum(['configured', 'not_configured']),
  configured: z.boolean(),
  missing: z.array(z.string()),
  fromNumberPresent: z.boolean(),
  message: z.string(),
});
export type SmsStatus = z.infer<typeof SmsStatusSchema>;

export const StormDraftSchema = z.object({
  contactId: z.string(),
  name: z.string(),
  phone: z.string(),
  propertyId: z.string(),
  address: z.string(),
  body: z.string(),
});
export type StormDraft = z.infer<typeof StormDraftSchema>;

export const DraftResponseSchema = z.object({
  event: HailEventSchema,
  radiusMiles: z.number(),
  source: z.string(),
  checkedAt: z.string(),
  smsStatus: z.object({
    provider: z.string(),
    state: z.enum(['configured', 'not_configured']),
    configured: z.boolean(),
    missing: z.array(z.string()),
    message: z.string(),
  }),
  drafts: z.array(StormDraftSchema),
  excluded: z.object({ noPhone: z.number(), noSmsConsent: z.number(), total: z.number() }),
  note: z.string(),
});
export type DraftResponse = z.infer<typeof DraftResponseSchema>;

export const SendResponseSchema = z.object({
  event: HailEventSchema,
  sent: z.number(),
  failed: z.number(),
  results: z.array(
    z.object({
      to: z.string(),
      name: z.string(),
      ok: z.boolean(),
      providerMessageId: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export type SendResponse = z.infer<typeof SendResponseSchema>;

// Hail swath: GET /v1/roof-storms/swath. Mirrors the API response verbatim —
// the swath is a GeoJSON FeatureCollection of Polygon/MultiPolygon hail-path
// features drawn over the satellite map. `kind` tells the map how to style it
// (measured MRMS swath vs approximate path from storm reports); `note` is
// shown to the user word for word.
const SwathPositionSchema = z.array(z.number());
const SwathLinearRingSchema = z.array(SwathPositionSchema);
const SwathPolygonCoordinatesSchema = z.array(SwathLinearRingSchema);
const SwathMultiPolygonCoordinatesSchema = z.array(SwathPolygonCoordinatesSchema);
const SwathGeometrySchema = z.union([
  z.object({ type: z.literal('Polygon'), coordinates: SwathPolygonCoordinatesSchema }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: SwathMultiPolygonCoordinatesSchema }),
]);
export type SwathGeometry = z.infer<typeof SwathGeometrySchema>;

export const SwathFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: SwathGeometrySchema,
  properties: z.object({ maxHailIn: z.number() }),
});
export type SwathFeature = z.infer<typeof SwathFeatureSchema>;

export const SwathFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(SwathFeatureSchema),
});
export type SwathFeatureCollection = z.infer<typeof SwathFeatureCollectionSchema>;

export const SwathSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  kind: z.enum(['mrms_swath', 'approximate_path']),
  source: z.enum(['NOAA MRMS MESH Max 1440min', 'NOAA Storm Prediction Center']),
  checkedAt: z.string(),
  date: z.string(),
  thresholdIn: z.number(),
  swath: SwathFeatureCollectionSchema,
  eventCount: z.number(),
  message: z.string(),
  note: z.string(),
});
export type Swath = z.infer<typeof SwathSchema>;

export const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const usdFromMinor = (minor: number) => usd.format(minor / 100);
