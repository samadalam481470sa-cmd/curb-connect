// Tables owned by the `curb` module (CP pages 042-055): projects, typed intake observations
// (known or unknown, with provenance), calibrations, segments, measurements, risk flags, permit
// requirements and safety reviews. All lengths in meters, areas m2, volumes m3.
import { sql } from 'drizzle-orm';
import { boolean, date, integer, jsonb, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { geometry, rateColumn, revisionColumn, tsColumn } from './_columns';
import {
  calibrationMethodEnum,
  calibrationStatusEnum,
  curbMeasurementKindEnum,
  curbProfileEnum,
  curbProjectStatusEnum,
  curbSegmentKindEnum,
  curbServiceCodeEnum,
  evidenceSourceEnum,
  measurementSourceEnum,
  permitStatusEnum,
  riskFlagKindEnum,
  riskFlagStatusEnum,
  riskSeverityEnum,
  safetyReviewKindEnum,
  safetyReviewStatusEnum,
} from './_enums';
import { type TenantParent, tenantTable } from './_tenant';
import { contacts, customers } from './crm';
import { jobs } from './jobs';
import { mediaAssets } from './media';
import { jurisdictions, properties } from './properties';
import { memberships } from './team';

export const curbProjects = tenantTable(
  'curb_projects',
  {
    number: text('number').notNull(),
    propertyId: uuid('property_id').notNull(),
    jobId: uuid('job_id'),
    customerId: uuid('customer_id'),
    contactId: uuid('contact_id'),
    serviceCode: curbServiceCodeEnum('service_code').notNull(),
    status: curbProjectStatusEnum('status').notNull().default('intake'),
    jurisdictionId: uuid('jurisdiction_id').references(() => jurisdictions.id),
    jurisdictionRulesVersion: text('jurisdiction_rules_version'),
    curbProfile: curbProfileEnum('curb_profile').notNull().default('unknown'),
    isPublicRightOfWay: boolean('is_public_right_of_way'),
    siteLocation: geometry('site_location', 'Point'),
    description: text('description'),
    assignedMembershipId: uuid('assigned_membership_id'),
    requestedStartOn: date('requested_start_on'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.uniq('orgId', 'number'),
    h.idx('orgId', 'status'),
    h.fk('propertyId', () => properties),
    h.fk('jobId', () => jobs),
    h.fk('customerId', () => customers),
    h.fk('contactId', () => contacts),
    h.fk('assignedMembershipId', () => memberships),
  ],
);

/**
 * Typed intake answers. `state` is 'known' or 'unknown'; known answers carry exactly one typed
 * value column plus unit (SI) and source. Unknown is a first-class answer, never a null guess.
 */
export const curbObservations = tenantTable(
  'curb_observations',
  {
    curbProjectId: uuid('curb_project_id').notNull(),
    questionKey: text('question_key').notNull(),
    state: text('state').notNull(),
    valueText: text('value_text'),
    valueNumber: rateColumn('value_number'),
    valueBoolean: boolean('value_boolean'),
    valueJson: jsonb('value_json'),
    unit: text('unit'),
    unknownReason: text('unknown_reason'),
    source: measurementSourceEnum('source'),
    evidenceSource: evidenceSourceEnum('evidence_source'),
    mediaAssetIds: uuid('media_asset_ids').array().notNull().default(sql`'{}'`),
    answeredByUserId: uuid('answered_by_user_id'),
    answeredViaPortal: boolean('answered_via_portal').notNull().default(false),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('curbProjectId', () => curbProjects, 'cascade'), h.uniq('curbProjectId', 'questionKey')],
);

export const calibrations = tenantTable(
  'calibrations',
  {
    curbProjectId: uuid('curb_project_id').notNull(),
    mediaAssetId: uuid('media_asset_id').notNull(),
    method: calibrationMethodEnum('method').notNull(),
    status: calibrationStatusEnum('status').notNull().default('pending'),
    /** Reference object and its known size in meters. */
    referenceLabel: text('reference_label'),
    referenceLengthM: rateColumn('reference_length_m'),
    /** Image points / homography matrix. */
    controlPoints: jsonb('control_points').notNull(),
    metersPerPixel: rateColumn('meters_per_pixel'),
    residualErrorM: rateColumn('residual_error_m'),
    /** Relative uncertainty 0..1 propagated to measurements. */
    uncertainty: numeric('uncertainty', { precision: 6, scale: 4 }),
    createdByUserId: uuid('created_by_user_id'),
    supersedesId: uuid('supersedes_id'),
  },
  (_t, h) => [
    h.fk('curbProjectId', () => curbProjects, 'cascade'),
    h.fk('mediaAssetId', () => mediaAssets),
    h.fk('supersedesId', (): TenantParent => calibrations),
  ],
);

export const curbSegments = tenantTable(
  'curb_segments',
  {
    curbProjectId: uuid('curb_project_id').notNull(),
    kind: curbSegmentKindEnum('kind').notNull(),
    label: text('label'),
    /** Georeferenced path when known (WGS84). */
    path: geometry('path', 'LineString'),
    footprint: geometry('footprint', 'Polygon'),
    /** Image-space geometry on a calibrated photo. */
    imageGeometry: jsonb('image_geometry'),
    mediaAssetId: uuid('media_asset_id'),
    calibrationId: uuid('calibration_id'),
    source: measurementSourceEnum('source').notNull().default('user_entered'),
    sortOrder: integer('sort_order').notNull().default(0),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('curbProjectId', () => curbProjects, 'cascade'),
    h.fk('mediaAssetId', () => mediaAssets),
    h.fk('calibrationId', (): TenantParent => calibrations),
  ],
);

export const curbMeasurements = tenantTable(
  'curb_measurements',
  {
    curbProjectId: uuid('curb_project_id').notNull(),
    segmentId: uuid('segment_id'),
    kind: curbMeasurementKindEnum('kind').notNull(),
    state: text('state').notNull(),
    /** SI value (m, m2, m3, count, ratio). */
    value: rateColumn('value'),
    unit: text('unit'),
    low: rateColumn('low'),
    high: rateColumn('high'),
    source: measurementSourceEnum('source'),
    calibrationId: uuid('calibration_id'),
    mediaAssetId: uuid('media_asset_id'),
    unknownReason: text('unknown_reason'),
    measuredAt: tsColumn('measured_at'),
    measuredByUserId: uuid('measured_by_user_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('curbProjectId', () => curbProjects, 'cascade'),
    h.fk('segmentId', () => curbSegments),
    h.fk('calibrationId', (): TenantParent => calibrations),
    h.fk('mediaAssetId', () => mediaAssets),
    h.idx('curbProjectId', 'kind'),
  ],
);

export const riskFlags = tenantTable(
  'risk_flags',
  {
    curbProjectId: uuid('curb_project_id').notNull(),
    kind: riskFlagKindEnum('kind').notNull(),
    severity: riskSeverityEnum('severity').notNull(),
    status: riskFlagStatusEnum('status').notNull().default('open'),
    evidenceSource: evidenceSourceEnum('evidence_source').notNull(),
    evidence: jsonb('evidence'),
    ruleVersion: text('rule_version'),
    message: text('message').notNull(),
    resolvedByUserId: uuid('resolved_by_user_id'),
    resolvedAt: tsColumn('resolved_at'),
    resolutionNote: text('resolution_note'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('curbProjectId', () => curbProjects, 'cascade'), h.idx('curbProjectId', 'status')],
);

export const permitRequirements = tenantTable(
  'permit_requirements',
  {
    curbProjectId: uuid('curb_project_id').notNull(),
    jurisdictionId: uuid('jurisdiction_id').references(() => jurisdictions.id),
    rulesVersion: text('rules_version'),
    permitType: text('permit_type').notNull(),
    status: permitStatusEnum('status').notNull().default('unknown'),
    applicationReference: text('application_reference'),
    submittedAt: tsColumn('submitted_at'),
    approvedAt: tsColumn('approved_at'),
    expiresOn: date('expires_on'),
    evidence: jsonb('evidence'),
    notes: text('notes'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('curbProjectId', () => curbProjects, 'cascade'), h.uniq('curbProjectId', 'permitType')],
);

export const safetyReviews = tenantTable(
  'safety_reviews',
  {
    curbProjectId: uuid('curb_project_id').notNull(),
    kind: safetyReviewKindEnum('kind').notNull(),
    status: safetyReviewStatusEnum('status').notNull().default('pending'),
    reviewerMembershipId: uuid('reviewer_membership_id'),
    checklist: jsonb('checklist'),
    evidence: jsonb('evidence'),
    reviewedAt: tsColumn('reviewed_at'),
    expiresAt: tsColumn('expires_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('curbProjectId', () => curbProjects, 'cascade'),
    h.fk('reviewerMembershipId', () => memberships),
    h.uniq('curbProjectId', 'kind'),
  ],
);
