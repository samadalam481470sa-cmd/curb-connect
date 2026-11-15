// Curb track contracts (Fieldline CV-041..CV-050, CP-051..CP-060; Construction OS COS-226..COS-250;
// addendum ADD-040..ADD-056): intake question catalog with explicit unknown, the guided capture
// protocol with safety copy, curb command payloads (registered in COMMAND_PAYLOADS), calibration,
// segment geometry, photo quality / recognition results, curb estimates and dispatch readiness.
// Command payloads are snake_case like the envelope; every other DTO is camelCase.
import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common';
import * as E from './enums';
import { MeasurementSchema } from './measurement';

// ================================================================ intake (CV-041, CV-042)
export const INTAKE_ANSWER_TYPES = ['boolean', 'number', 'text', 'choice'] as const;

export interface IntakeQuestion {
  key: string;
  label: string;
  type: (typeof INTAKE_ANSWER_TYPES)[number];
  unit?: 'm' | 'count';
  choices?: readonly string[];
  /** CV-042 B: permit/engineer questions are shown before any price. */
  early: boolean;
  help: string;
}

/**
 * CV-042 typed intake questions. Every question accepts `unknown`; an unanswered question is
 * unknown, never false. Keys are stable (rules and tests reference them).
 */
export const CURB_INTAKE_QUESTIONS: readonly IntakeQuestion[] = [
  { key: 'ownership', label: 'Who owns the curb at the work location?', type: 'choice', choices: ['private', 'public', 'shared'], early: true, help: 'City-owned curb or right-of-way needs municipal authorization.' },
  { key: 'project_purpose', label: 'What is the work for?', type: 'text', early: false, help: 'For example a new driveway opening or a damaged section.' },
  { key: 'requested_width', label: 'Rough requested width', type: 'number', unit: 'm', early: false, help: 'A rough figure is fine; it is verified later.' },
  { key: 'desired_work_date', label: 'Desired work date', type: 'text', early: false, help: 'ISO date.' },
  { key: 'sidewalk_affected', label: 'Could a sidewalk or pedestrian path be affected?', type: 'boolean', early: true, help: 'Pedestrian routes may need accessible-route review.' },
  { key: 'curb_ramp_affected', label: 'Is an existing curb ramp nearby or affected?', type: 'boolean', early: true, help: 'Ramps are accessibility features and need review.' },
  { key: 'drainage_affected', label: 'Could gutter flow or drainage be affected?', type: 'boolean', early: true, help: 'Drainage changes can need engineering review.' },
  { key: 'adjacent_pavement_affected', label: 'Will adjoining pavement be cut or restored?', type: 'boolean', early: false, help: 'Restoration is priced separately.' },
  { key: 'utilities_nearby', label: 'Are utility covers, valves or markings near the work?', type: 'boolean', early: true, help: 'A utility locate is always required before cutting.' },
  { key: 'traffic_lane_affected', label: 'Does the work touch a live traffic or parking lane?', type: 'boolean', early: true, help: 'Traffic control may be required.' },
  { key: 'permit_known_required', label: 'Has the city said a permit is required?', type: 'boolean', early: true, help: 'Unknown is a valid answer.' },
  { key: 'engineer_review_required', label: 'Has anyone asked for an engineer review?', type: 'boolean', early: true, help: 'Grades, drainage and structural work may need one.' },
];
export const CURB_INTAKE_QUESTION_KEYS = CURB_INTAKE_QUESTIONS.map((q) => q.key);

// ================================================================ guided capture (CV-043)
export interface CaptureShot {
  viewType: E.MediaViewType;
  label: string;
  required: boolean;
  /** CV-043 S: a shot that could require standing in a roadway is never mandatory. */
  roadwayRisk: boolean;
  safety: string;
  instructions: string;
}

export const CURB_CAPTURE_PROTOCOL_VERSION = 'curb-capture@1.0.0';
export const CURB_CAPTURE_PROTOCOL: readonly CaptureShot[] = [
  { viewType: 'overview_straight_on', label: 'Straight-on overview', required: true, roadwayRisk: false, safety: 'Stand on the sidewalk or driveway. Never step into a live lane.', instructions: 'Face the curb squarely and include both ends of the work area.' },
  { viewType: 'wide_approach', label: 'Wide approach view', required: true, roadwayRisk: false, safety: 'Shoot from the sidewalk; keep a safe distance from moving traffic.', instructions: 'Show the street, the driveway and neighbouring curb.' },
  { viewType: 'scale_reference', label: 'Known-length reference in plane', required: true, roadwayRisk: false, safety: 'Place the tape or reference from the curb top, not from the road.', instructions: 'Lay a tape measure or a reference of known length flat along the curb face.' },
  { viewType: 'top_view', label: 'Top view (only where safe)', required: false, roadwayRisk: true, safety: 'Skip this if you would have to stand in the roadway.', instructions: 'Hold the phone over the curb looking down.' },
  { viewType: 'end_cross_section', label: 'End cross-section (if visible)', required: false, roadwayRisk: false, safety: 'Do not dig or expose buried concrete or utilities.', instructions: 'Photograph an exposed end only if it is already visible.' },
  { viewType: 'gutter', label: 'Gutter and drainage', required: false, roadwayRisk: true, safety: 'Shoot from the curb top; never stand in the gutter of a live lane.', instructions: 'Show gutter flow line, drains and inlets.' },
  { viewType: 'sidewalk', label: 'Sidewalk', required: false, roadwayRisk: false, safety: 'Keep the path clear for pedestrians.', instructions: 'Show the sidewalk and any ramp near the work.' },
  { viewType: 'driveway_slope', label: 'Driveway slope', required: false, roadwayRisk: false, safety: 'Stand on the driveway, out of traffic.', instructions: 'Shoot from the side to show the slope.' },
  { viewType: 'adjoining_pavement', label: 'Adjoining pavement', required: false, roadwayRisk: false, safety: 'Stay off the roadway.', instructions: 'Show pavement that would be cut or restored.' },
  { viewType: 'utility_feature', label: 'Utility covers, valves, markings', required: false, roadwayRisk: false, safety: 'Never open covers or expose utilities.', instructions: 'Photograph covers, paint markings and signs near the work.' },
  { viewType: 'traffic_context', label: 'Traffic context', required: false, roadwayRisk: true, safety: 'Shoot from the sidewalk only.', instructions: 'Show lanes, parking, and signs near the work.' },
];

// ================================================================ command payloads (ADD-014)
const ObservationAnswerSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unknown'), reason: z.string().max(80).default('not_provided'), note: z.string().max(2000).optional() }),
  z.object({
    state: z.literal('known'),
    value: z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
    unit: z.string().max(16).optional(),
    source: E.MeasurementSourceSchema,
    evidence_source: E.EvidenceSourceSchema.optional(),
  }),
]);
export type CurbObservationAnswer = z.infer<typeof ObservationAnswerSchema>;

const PlanePoint = z.tuple([z.number().finite(), z.number().finite()]);

/** One piece of a piecewise curb trace (CV-047). Curved pieces need >= 3 points. */
export const SegmentPieceSchema = z.object({
  shape: z.enum(['straight', 'curved', 'corner', 'return_transition']),
  points: z.array(PlanePoint).min(2).max(2000),
});
export const SegmentGeometrySchema = z.object({
  /** image_px needs an accepted calibration; plane_m is entered in meters (site sketch / survey). */
  space: z.enum(['image_px', 'plane_m']),
  pieces: z.array(SegmentPieceSchema).min(1).max(50),
});

export const CURB_COMMAND_PAYLOADS = {
  CurbProjectUpdated: z
    .object({
      service_code: E.CurbServiceCodeSchema.optional(),
      curb_profile: E.CurbProfileSchema.optional(),
      is_public_right_of_way: z.boolean().nullable().optional(),
      description: z.string().max(4000).nullable().optional(),
      status: E.CurbProjectStatusSchema.optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: 'nothing to change' }),
  CurbObservationsAnswered: z.object({
    answers: z
      .array(z.object({ question_key: z.string().min(1).max(80), answer: ObservationAnswerSchema, media_asset_ids: z.array(UuidSchema).max(20).default([]) }))
      .min(1)
      .max(100),
  }),
  CurbCalibrationRecorded: z.object({
    media_asset_id: UuidSchema,
    method: z.enum(['two_point_reference', 'four_point_homography', 'field_dimensions']),
    reference_label: z.string().max(120).optional(),
    reference_length_m: z.number().positive().max(100).optional(),
    image_points: z.array(PlanePoint).max(12).default([]),
    world_points_m: z.array(PlanePoint).max(12).optional(),
  }),
  CurbSegmentSaved: z.object({
    /** Present = correction of an existing segment (new version, history kept). */
    segment_id: UuidSchema.optional(),
    kind: E.CurbSegmentKindSchema,
    label: z.string().max(120).optional(),
    media_asset_id: UuidSchema.optional(),
    calibration_id: UuidSchema.optional(),
    geometry: SegmentGeometrySchema,
    correction_reason: z.string().max(2000).optional(),
  }),
  CurbMeasurementRecorded: z.object({
    kind: E.CurbMeasurementKindSchema,
    segment_id: UuidSchema.optional(),
    measurement: MeasurementSchema,
    calibration_id: UuidSchema.optional(),
  }),
  CurbRiskFlagRaised: z.object({
    kind: E.RiskFlagKindSchema,
    severity: E.RiskSeveritySchema,
    message: z.string().min(3).max(2000),
    evidence_source: E.EvidenceSourceSchema,
  }),
  CurbRiskFlagResolved: z.object({
    risk_flag_id: UuidSchema,
    status: z.enum(['mitigated', 'resolved', 'dismissed']),
    resolution_note: z.string().min(3).max(2000),
  }),
  CurbPermitUpdated: z.object({
    permit_type: z.string().min(2).max(80),
    status: E.PermitStatusSchema,
    application_reference: z.string().max(120).optional(),
    expires_on: IsoDateSchema.optional(),
    notes: z.string().max(4000).optional(),
    checklist: z.array(z.object({ item: z.string().max(200), done: z.boolean() })).max(50).optional(),
  }),
  CurbSafetyReviewDecided: z.object({
    kind: E.SafetyReviewKindSchema,
    status: z.enum(['approved', 'rejected', 'not_applicable']),
    checklist: z.array(z.object({ item: z.string().max(200), done: z.boolean() })).min(1).max(50),
    expires_at: IsoDateTimeSchema.optional(),
    note: z.string().max(2000).optional(),
  }),
  /** Estimate aggregate: re-derive inputs and site conditions from the curb project and reprice. */
  CurbEstimateSynced: z.object({}),
} as const;
export type CurbCommandType = keyof typeof CURB_COMMAND_PAYLOADS;

/** Typed endpoint body: the payload (camel or snake as defined above) plus the edited revision. */
export const curbCommandBody = <T extends z.ZodType>(payload: T) => z.object({ expectedRevision: z.number().int().nonnegative(), payload });

// ================================================================ calibration result (CV-045)
export const CurbCalibrationSchema = z.object({
  id: UuidSchema,
  curbProjectId: UuidSchema,
  mediaAssetId: UuidSchema,
  method: E.CalibrationMethodSchema,
  status: E.CalibrationStatusSchema,
  referenceLabel: z.string().nullable(),
  referenceLengthM: z.number().nullable(),
  metersPerPixel: z.number().nullable(),
  residualErrorM: z.number().nullable(),
  uncertainty: z.number().nullable(),
  failure: z.object({ reason: z.string(), message: z.string(), next: z.string() }).nullable(),
  engineVersion: z.string(),
  supersedesId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});

// ================================================================ vision results (CV-044, CV-046)
export const PhotoQualityOutcomeSchema = z.object({
  mediaAssetId: UuidSchema,
  viewType: z.string().nullable(),
  verdict: z.enum(['usable', 'usable_with_warnings', 'retake_required']),
  /** CV-044: actionable replace instructions, one per failing/warning check. */
  instructions: z.array(z.object({ code: z.string(), severity: z.enum(['warn', 'fail']), message: z.string(), action: z.string() })),
  duplicateOf: z.array(UuidSchema),
  gpsPresent: z.boolean(),
  metricVersion: z.string(),
  thresholdsVersion: z.string(),
});

export const CurbRecognitionOutcomeSchema = z.object({
  mediaAssetId: UuidSchema,
  /** AIQ-087: an abstention is surfaced as manual review, never as a low-confidence guess. */
  status: z.enum(['manual_review', 'suggestion']),
  reason: z.string(),
  model: z.object({ modelId: z.string(), version: z.string() }).nullable(),
  /** Suggestions only; never applied to measurements without a person. */
  suggestions: z.unknown().nullable(),
  /** Fields a photo can never establish. */
  neverInferred: z.array(z.string()),
});

// ================================================================ capture checklist (CV-043 D)
export const CaptureChecklistSchema = z.object({
  protocolVersion: z.string(),
  complete: z.boolean(),
  shots: z.array(
    z.object({
      viewType: z.string(),
      label: z.string(),
      required: z.boolean(),
      roadwayRisk: z.boolean(),
      safety: z.string(),
      instructions: z.string(),
      status: z.enum(['missing', 'captured', 'retake_required', 'not_scored']),
      mediaAssetIds: z.array(UuidSchema),
    }),
  ),
  instructions: z.array(z.string()),
});

// ================================================================ estimate + readiness (CP-058, CP-060)
export const CreateCurbEstimateRequestSchema = z.object({
  /** Price-book line specs; quantities come from recorded measurements via quantityKey. */
  lines: z
    .array(z.object({ code: z.string().regex(/^[A-Z0-9_]{2,40}$/), quantityKey: z.string().min(1).max(80).optional(), quantity: z.string().regex(/^\d+(\.\d+)?$/).optional(), critical: z.boolean().default(true) }))
    .min(1)
    .max(200),
  priceBookRevisionId: UuidSchema.optional(),
  assumptions: z.array(z.string().max(500)).max(50).default([]),
});

export const CurbGateSchema = z.object({ code: z.string(), message: z.string(), resolution: z.string() });
export const CurbReadinessSchema = z.object({
  curbProjectId: UuidSchema,
  /** CP-059: firm approval possible only when no hard gate remains. */
  canApproveFirm: z.boolean(),
  /** CP-060 / COS-24x: never dispatch with missing permits, utility checks, reviews or safety prerequisites. */
  canDispatch: z.boolean(),
  quoteKind: z.enum(['firm', 'budgetary_range', 'review_required']),
  gates: z.array(CurbGateSchema),
  siteConditions: z.record(z.string(), z.unknown()),
  rulesVersion: z.string(),
});
export type CurbReadiness = z.infer<typeof CurbReadinessSchema>;
