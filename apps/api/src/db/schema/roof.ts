// Tables owned by the `roof` module (RR pages 004-041): orders and their immutable transition
// log, reports and immutable report versions, topology (facets, vertices, shared edges stored
// once), the geometry command log, append-only measurement overrides, materials and takeoffs.
// Geometry is stored in a local planar frame in meters (canonical SI) per report version, with
// the georeference in roof_report_versions.georef; see the roof-geometry JSON schema in contracts.
import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, integer, jsonb, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, rateColumn, revisionColumn, tsColumn } from './_columns';
import {
  actorTypeEnum,
  materialClassEnum,
  measurementSourceEnum,
  roofDeliverySpeedEnum,
  roofEdgeTypeEnum,
  roofOrderModeEnum,
  roofOrderStatusEnum,
  roofReportStatusEnum,
  roofReportVersionStatusEnum,
  roofSurfaceTypeEnum,
  wasteSourceEnum,
} from './_enums';
import { type TenantParent, tenantTable } from './_tenant';
import { imageryAssets } from './imagery';
import { jobs } from './jobs';
import { properties, structures } from './properties';
import { memberships } from './team';

export const roofOrders = tenantTable(
  'roof_orders',
  {
    number: text('number').notNull(),
    propertyId: uuid('property_id').notNull(),
    jobId: uuid('job_id'),
    mode: roofOrderModeEnum('mode').notNull(),
    deliverySpeed: roofDeliverySpeedEnum('delivery_speed').notNull().default('standard'),
    status: roofOrderStatusEnum('status').notNull().default('draft'),
    structureIds: uuid('structure_ids').array().notNull().default(sql`'{}'`),
    imageryAssetId: uuid('imagery_asset_id'),
    requestedByMembershipId: uuid('requested_by_membership_id'),
    instructions: text('instructions'),
    dueAt: tsColumn('due_at'),
    priceMinor: minorUnits('price_minor'),
    currency: currencyColumn(),
    usageReservationId: uuid('usage_reservation_id'),
    failureReason: text('failure_reason'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.uniq('orgId', 'number'),
    h.idx('orgId', 'status'),
    h.fk('propertyId', () => properties),
    h.fk('jobId', () => jobs),
    h.fk('imageryAssetId', () => imageryAssets),
    h.fk('requestedByMembershipId', () => memberships),
  ],
);

/** Immutable status transitions (insert-only; trigger rejects UPDATE/DELETE). */
export const roofOrderEvents = tenantTable(
  'roof_order_events',
  {
    roofOrderId: uuid('roof_order_id').notNull(),
    fromStatus: roofOrderStatusEnum('from_status'),
    toStatus: roofOrderStatusEnum('to_status').notNull(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorUserId: uuid('actor_user_id'),
    reason: text('reason'),
    data: jsonb('data'),
    occurredAt: tsColumn('occurred_at').notNull().defaultNow(),
    correlationId: text('correlation_id'),
  },
  (_t, h) => [h.fk('roofOrderId', () => roofOrders), h.idx('roofOrderId', 'occurredAt')],
);

export const roofReports = tenantTable(
  'roof_reports',
  {
    roofOrderId: uuid('roof_order_id').notNull(),
    structureId: uuid('structure_id'),
    status: roofReportStatusEnum('status').notNull().default('drafting'),
    currentVersionId: uuid('current_version_id'),
    issuedVersionId: uuid('issued_version_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('roofOrderId', () => roofOrders),
    h.fk('structureId', () => structures),
    h.idx('roofOrderId'),
  ],
);

/**
 * Snapshot of a report. Editable only while status = 'draft'; every later status is immutable
 * (trigger), so historical reports can always be reconstructed (RR-037, BE-074 G).
 */
export const roofReportVersions = tenantTable(
  'roof_report_versions',
  {
    roofReportId: uuid('roof_report_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    status: roofReportVersionStatusEnum('status').notNull().default('draft'),
    geometryRevision: integer('geometry_revision').notNull().default(0),
    /** Canonical roof-geometry JSON (contracts RoofGeometrySchema) frozen at submit. */
    geometry: jsonb('geometry'),
    /** Totals in SI: { planAreaM2, slopedAreaM2, edges: { eave: m, ... }, predominantPitch }. */
    totals: jsonb('totals'),
    georef: jsonb('georef'),
    crs: text('crs').notNull().default('LOCAL_ENU_M'),
    imageryAssetId: uuid('imagery_asset_id'),
    engineVersions: jsonb('engine_versions').notNull().default(sql`'{}'::jsonb`),
    validation: jsonb('validation'),
    unresolvedIssues: jsonb('unresolved_issues').notNull().default(sql`'[]'::jsonb`),
    submittedAt: tsColumn('submitted_at'),
    submittedByUserId: uuid('submitted_by_user_id'),
    approvedAt: tsColumn('approved_at'),
    approvedByUserId: uuid('approved_by_user_id'),
    supersedesVersionId: uuid('supersedes_version_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('roofReportId', () => roofReports),
    h.uniq('roofReportId', 'versionNumber'),
    h.fk('imageryAssetId', () => imageryAssets),
    h.fk('supersedesVersionId', (): TenantParent => roofReportVersions),
  ],
);

export const roofFacets = tenantTable(
  'roof_facets',
  {
    reportVersionId: uuid('report_version_id').notNull(),
    key: text('key').notNull(),
    label: text('label'),
    surfaceType: roofSurfaceTypeEnum('surface_type').notNull().default('pitched'),
    /** Ordered vertex keys (counter-clockwise in plan view). */
    vertexKeys: text('vertex_keys').array().notNull(),
    pitchRise: numeric('pitch_rise', { precision: 8, scale: 4 }),
    pitchRun: numeric('pitch_run', { precision: 8, scale: 4 }).default('12'),
    pitchRatio: rateColumn('pitch_ratio'),
    pitchSource: measurementSourceEnum('pitch_source'),
    azimuthDeg: doublePrecision('azimuth_deg'),
    planAreaM2: rateColumn('plan_area_m2'),
    slopedAreaM2: rateColumn('sloped_area_m2'),
    areaSource: measurementSourceEnum('area_source'),
    parentFacetKey: text('parent_facet_key'),
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (_t, h) => [h.fk('reportVersionId', (): TenantParent => roofReportVersions, 'cascade'), h.uniq('reportVersionId', 'key')],
);

export const roofVertices = tenantTable(
  'roof_vertices',
  {
    reportVersionId: uuid('report_version_id').notNull(),
    key: text('key').notNull(),
    /** Local plan coordinates in meters; z is elevation when known. */
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    z: doublePrecision('z'),
    source: measurementSourceEnum('source').notNull().default('user_entered'),
  },
  (_t, h) => [h.fk('reportVersionId', (): TenantParent => roofReportVersions, 'cascade'), h.uniq('reportVersionId', 'key')],
);

/** An edge is stored once and shared by up to two facets (left/right). */
export const roofEdges = tenantTable(
  'roof_edges',
  {
    reportVersionId: uuid('report_version_id').notNull(),
    key: text('key').notNull(),
    fromVertexKey: text('from_vertex_key').notNull(),
    toVertexKey: text('to_vertex_key').notNull(),
    leftFacetKey: text('left_facet_key'),
    rightFacetKey: text('right_facet_key'),
    edgeType: roofEdgeTypeEnum('edge_type').notNull().default('unclassified'),
    classificationSource: measurementSourceEnum('classification_source'),
    lengthM: rateColumn('length_m'),
  },
  (_t, h) => [
    h.fk('reportVersionId', (): TenantParent => roofReportVersions, 'cascade'),
    h.uniq('reportVersionId', 'key'),
    h.uniq('reportVersionId', 'fromVertexKey', 'toVertexKey'),
  ],
);

/** Command log of geometry edits (undo/redo, audit, replay). Append-only. */
export const roofGeometryOps = tenantTable(
  'roof_geometry_ops',
  {
    reportVersionId: uuid('report_version_id').notNull(),
    sequence: integer('sequence').notNull(),
    op: text('op').notNull(),
    payload: jsonb('payload').notNull(),
    baseGeometryRevision: integer('base_geometry_revision').notNull(),
    actorUserId: uuid('actor_user_id'),
    clientOpId: text('client_op_id'),
  },
  (_t, h) => [
    h.fk('reportVersionId', (): TenantParent => roofReportVersions, 'cascade'),
    h.uniq('reportVersionId', 'sequence'),
    h.uniq('reportVersionId', 'clientOpId'),
  ],
);

/** Human overrides of computed measurements; append-only (a later row supersedes). */
export const measurementOverrides = tenantTable(
  'measurement_overrides',
  {
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    field: text('field').notNull(),
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value').notNull(),
    unit: text('unit'),
    source: measurementSourceEnum('source').notNull(),
    reason: text('reason').notNull(),
    actorUserId: uuid('actor_user_id'),
    supersedesId: uuid('supersedes_id'),
  },
  (_t, h) => [h.idx('orgId', 'subjectType', 'subjectId'), h.fk('supersedesId', (): TenantParent => measurementOverrides)],
);

export const materialCatalogItems = tenantTable(
  'material_catalog_items',
  {
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    materialClass: materialClassEnum('material_class').notNull(),
    manufacturer: text('manufacturer'),
    /** Coverage per purchase unit in SI (m2 for area items, m for linear items). */
    coverageQuantity: rateColumn('coverage_quantity').notNull(),
    coverageUnit: text('coverage_unit').notNull(),
    purchaseUnit: text('purchase_unit').notNull(),
    unitCostMinor: minorUnits('unit_cost_minor'),
    currency: currencyColumn(),
    active: boolean('active').notNull().default(true),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'sku')],
);

export const wastePolicies = tenantTable(
  'waste_policies',
  {
    name: text('name').notNull(),
    /** Rules: [{ when: { complexity, pitchMin, ... }, wasteFraction: "0.12" }]. */
    rules: jsonb('rules').notNull(),
    defaultWasteFraction: rateColumn('default_waste_fraction').notNull(),
    active: boolean('active').notNull().default(true),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'name')],
);

export const materialTakeoffs = tenantTable(
  'material_takeoffs',
  {
    reportVersionId: uuid('report_version_id').notNull(),
    wastePolicyId: uuid('waste_policy_id'),
    wasteFraction: rateColumn('waste_fraction').notNull(),
    wasteSource: wasteSourceEnum('waste_source').notNull(),
    /** Lines: [{ materialClass, sku, quantitySi, unit, purchaseQuantity, purchaseUnit }]. */
    lines: jsonb('lines').notNull(),
    engineVersion: text('engine_version').notNull(),
    createdByUserId: uuid('created_by_user_id'),
  },
  (_t, h) => [
    h.fk('reportVersionId', (): TenantParent => roofReportVersions),
    h.fk('wastePolicyId', () => wastePolicies),
    h.idx('reportVersionId'),
  ],
);
