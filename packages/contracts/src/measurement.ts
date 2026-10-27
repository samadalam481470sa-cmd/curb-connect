// STR-010 / PLT-019: every numeric input carries unit, source, date and precision, and "unknown"
// is a distinct state, never a default zero. Values are always in the canonical SI unit
// (docs/adr/0005); display units exist only for input/output conversion at the boundary.
import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common';
import { MeasurementSourceSchema } from './enums';

/** Canonical stored units. */
export const CANONICAL_UNITS = ['m', 'm2', 'm3', 'ratio', 'deg', 'count', 'kg'] as const;
export const CanonicalUnitSchema = z.enum(CANONICAL_UNITS);
export type CanonicalUnit = z.infer<typeof CanonicalUnitSchema>;

/** Units a person may type or see. Conversion lives in @fieldline/geometry. */
export const DISPLAY_UNITS = [
  'm',
  'cm',
  'mm',
  'ft',
  'in',
  'yd',
  'm2',
  'ft2',
  'yd2',
  'roofing_square',
  'm3',
  'ft3',
  'yd3',
  'deg',
  'rise_per_12',
  'percent',
  'count',
  'kg',
  'lb',
  'ton',
] as const;
export const DisplayUnitSchema = z.enum(DISPLAY_UNITS);
export type DisplayUnit = z.infer<typeof DisplayUnitSchema>;

/** Why a value is unknown. `not_observable` = cannot be seen in a photo (buried depth, rebar). */
export const UNKNOWN_REASONS = [
  'not_provided',
  'not_observable',
  'not_measured_yet',
  'calibration_failed',
  'model_abstained',
  'conflicting_evidence',
] as const;
export const UnknownReasonSchema = z.enum(UNKNOWN_REASONS);
export type UnknownReason = z.infer<typeof UnknownReasonSchema>;

export const MeasurementEvidenceSchema = z.object({
  mediaAssetIds: z.array(UuidSchema).default([]),
  calibrationId: UuidSchema.nullable().default(null),
  inferenceResultId: UuidSchema.nullable().default(null),
  note: z.string().max(2000).optional(),
});
export type MeasurementEvidence = z.infer<typeof MeasurementEvidenceSchema>;

export const UnknownValueSchema = z.object({
  state: z.literal('unknown'),
  reason: UnknownReasonSchema.default('not_provided'),
  note: z.string().max(2000).optional(),
});
export type UnknownValue = z.infer<typeof UnknownValueSchema>;

function knownSchema<U extends z.ZodType<CanonicalUnit>>(unit: U) {
  return z.object({
    state: z.literal('known'),
    value: z.number().finite(),
    unit,
    source: MeasurementSourceSchema,
    measuredAt: IsoDateTimeSchema,
    /** Absolute uncertainty in the same unit (e.g. 0.01 m). 0 only for counts or exact inputs. */
    precision: z.number().finite().nonnegative(),
    /** Model or calibration confidence in [0, 1]; never shown as a price guarantee (CV-050 D). */
    confidence: z.number().min(0).max(1).optional(),
    measuredByUserId: UuidSchema.optional(),
    evidence: MeasurementEvidenceSchema.optional(),
  });
}

/** Unknown-or-known measurement in any canonical unit. */
export const MeasurementSchema = z.discriminatedUnion('state', [
  UnknownValueSchema,
  knownSchema(CanonicalUnitSchema),
]);
export type Measurement = z.infer<typeof MeasurementSchema>;
export type KnownMeasurement = Extract<Measurement, { state: 'known' }>;

/** Unknown-or-known measurement restricted to one canonical unit, e.g. measurementOf('m'). */
export function measurementOf<const U extends CanonicalUnit>(unit: U) {
  return z.discriminatedUnion('state', [UnknownValueSchema, knownSchema(z.literal(unit))]);
}
export const LengthSchema = measurementOf('m');
export const AreaSchema = measurementOf('m2');
export const VolumeSchema = measurementOf('m3');
export const CountSchema = measurementOf('count');
export const RatioSchema = measurementOf('ratio');

export function unknown(reason: UnknownReason = 'not_provided', note?: string): UnknownValue {
  return note === undefined ? { state: 'unknown', reason } : { state: 'unknown', reason, note };
}

export function isKnown<M extends { state: string }>(m: M): m is Extract<M, { state: 'known' }> {
  return m.state === 'known';
}

/** Trusted dimensions (page 010 B): on-site measured or survey supplied. Photos are advisory. */
export const TRUSTED_SOURCES = ['field_verified', 'survey_supplied'] as const;
export function isTrusted(m: Measurement): boolean {
  return m.state === 'known' && (TRUSTED_SOURCES as readonly string[]).includes(m.source);
}

/**
 * RF-027: pitch as rise/run plus the original input. ratio = rise / run; slope factor =
 * sqrt(1 + ratio^2). `run` is positive; a flat roof is rise 0.
 */
export const PitchSchema = z.object({
  rise: z.number().finite().nonnegative(),
  run: z.number().finite().positive(),
  /** As typed, e.g. "6/12", "26.57 deg". */
  input: z.string().max(40),
  inputUnit: z.enum(['rise_per_12', 'deg', 'ratio', 'percent']),
  source: MeasurementSourceSchema,
  confidence: z.number().min(0).max(1).optional(),
});
export type Pitch = z.infer<typeof PitchSchema>;

export const PitchValueSchema = z.discriminatedUnion('state', [
  UnknownValueSchema,
  PitchSchema.extend({ state: z.literal('known') }),
]);
export type PitchValue = z.infer<typeof PitchValueSchema>;
