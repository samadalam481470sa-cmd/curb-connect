// Shared primitives for every API DTO: ids, timestamps, money, decimals, revisions, pagination.
// JSON is camelCase (BE-073). Money is integer minor units + ISO 4217 currency (docs/adr/0005).
import { z } from 'zod';

export const UuidSchema = z.uuid();
export type Uuid = z.infer<typeof UuidSchema>;

/** RFC 3339 timestamp with offset, always serialized in UTC by the API. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** Date-only fields (e.g. desired work date, invoice due date). */
export const IsoDateSchema = z.iso.date();
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** ISO 4217 alphabetic code. */
export const CurrencyCodeSchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'ISO 4217 currency code in upper case');
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

/**
 * Integer minor units (cents). Stored as bigint; carried in JSON as a safe integer, which is exact
 * (no floating point arithmetic ever touches money: packages/pricing uses decimal.js).
 */
export const MinorUnitsSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
export type MinorUnits = z.infer<typeof MinorUnitsSchema>;

export const MoneySchema = z.object({
  amountMinor: MinorUnitsSchema,
  currency: CurrencyCodeSchema,
});
export type Money = z.infer<typeof MoneySchema>;

export const NonNegativeMoneySchema = MoneySchema.extend({
  amountMinor: MinorUnitsSchema.nonnegative(),
});

/** Builds a Money value. Throws on a non-integer amount: callers must round at a named stage. */
export function money(amountMinor: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`money(): amountMinor must be a safe integer, got ${amountMinor}`);
  }
  return { amountMinor, currency };
}

/** Decimal carried as a string so it never passes through a float (rates, quantities, percents). */
export const DecimalStringSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)(\.\d+)?$/, 'decimal string such as "20" or "0.250000"');
export type DecimalString = z.infer<typeof DecimalStringSchema>;

/** numeric(18,6) unit rate: at most 12 integer digits and 6 fraction digits. */
export const RateStringSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d{0,11})(\.\d{1,6})?$/, 'rate with at most 6 decimal places');
export type RateString = z.infer<typeof RateStringSchema>;

/** A fraction in [0, 1) as a decimal string, e.g. "0.25" for a 25% target margin. */
export const FractionStringSchema = DecimalStringSchema.refine((value) => {
  const n = Number(value);
  return n >= 0 && n < 1;
}, 'fraction must be at least 0 and below 1');
export type FractionString = z.infer<typeof FractionStringSchema>;

/** Optimistic concurrency revision; PATCH sends it back via If-Match (mismatch -> 412). */
export const RevisionSchema = z.number().int().positive();
export type Revision = z.infer<typeof RevisionSchema>;

/** Idempotency-Key header value (BE-076): 8..128 visible ASCII characters. */
export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[\x21-\x7e]+$/, 'visible ASCII characters only');
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/** Fields present on every tenant resource returned by the API. */
export const ResourceMetaSchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  revision: RevisionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ResourceMeta = z.infer<typeof ResourceMetaSchema>;

// ---------------------------------------------------------------- pagination
export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

/** Query for cursor pagination. The cursor is opaque to clients. */
export const PageQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

/** `{ items, nextCursor }`; nextCursor is null on the last page. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------- addresses, GeoJSON
export const PostalAddressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  locality: z.string().min(1).max(120),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(20).optional(),
  countryCode: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/),
});
export type PostalAddress = z.infer<typeof PostalAddressSchema>;

/** [longitude, latitude] in WGS 84 (EPSG:4326). */
export const LonLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type LonLat = z.infer<typeof LonLatSchema>;

export const GeoPointSchema = z.object({ type: z.literal('Point'), coordinates: LonLatSchema });
export const GeoLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(LonLatSchema).min(2),
});
export const GeoPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(LonLatSchema).min(4)).min(1),
});
export const GeoMultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(LonLatSchema).min(4)).min(1)).min(1),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;
export type GeoLineString = z.infer<typeof GeoLineStringSchema>;
export type GeoPolygon = z.infer<typeof GeoPolygonSchema>;
export type GeoMultiPolygon = z.infer<typeof GeoMultiPolygonSchema>;

export const ActorRefSchema = z.object({
  userId: UuidSchema.nullable(),
  displayName: z.string().nullable(),
});
export type ActorRef = z.infer<typeof ActorRefSchema>;
