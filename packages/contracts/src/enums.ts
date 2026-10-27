// Every enumerated value shared by the API, the database (apps/api/src/db/schema uses these
// tuples for its Postgres enums, so a change here forces a migration) and the web app.
// Stored values are stable identifiers: never translate them, never rename one in place
// (PLT-019: localize labels at the boundary, not the stored enum).
import { z } from 'zod';

/** Builds a zod enum from a const tuple while keeping the tuple available for pgEnum(). */
const zEnum = <const T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

// ---------------------------------------------------------------- identity, tenancy, team
/** PLT-015: the eight member roles. The homeowner portal principal is never a member (STR-004). */
export const MEMBER_ROLES = [
  'owner',
  'admin',
  'estimator',
  'reviewer',
  'salesperson',
  'crew_manager',
  'finance',
  'read_only',
] as const;
export const MemberRoleSchema = zEnum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const ORG_STATUSES = ['active', 'suspended', 'closed'] as const;
export const OrgStatusSchema = zEnum(ORG_STATUSES);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

/** The two first-class products (PLT-011: equal prominence). */
export const PRODUCT_LINES = ['roof', 'curb'] as const;
export const ProductLineSchema = zEnum(PRODUCT_LINES);
export type ProductLine = z.infer<typeof ProductLineSchema>;

export const MEASUREMENT_SYSTEMS = ['imperial', 'metric'] as const;
export const MeasurementSystemSchema = zEnum(MEASUREMENT_SYSTEMS);
export type MeasurementSystem = z.infer<typeof MeasurementSystemSchema>;

export const USER_STATUSES = ['active', 'deactivated'] as const;
export const UserStatusSchema = zEnum(USER_STATUSES);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const IDENTITY_PROVIDERS = ['microsoft', 'dev_idp', 'email_link'] as const;
export const IdentityProviderSchema = zEnum(IDENTITY_PROVIDERS);
export type IdentityProvider = z.infer<typeof IdentityProviderSchema>;

export const MEMBERSHIP_STATUSES = ['active', 'suspended', 'revoked'] as const;
export const MembershipStatusSchema = zEnum(MEMBERSHIP_STATUSES);
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export const InvitationStatusSchema = zEnum(INVITATION_STATUSES);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

export const PERMISSION_EFFECTS = ['grant', 'deny'] as const;
export const PermissionEffectSchema = zEnum(PERMISSION_EFFECTS);
export type PermissionEffect = z.infer<typeof PermissionEffectSchema>;

export const SERVICE_AREA_KINDS = ['state', 'metro', 'county', 'city', 'custom'] as const;
export const ServiceAreaKindSchema = zEnum(SERVICE_AREA_KINDS);
export type ServiceAreaKind = z.infer<typeof ServiceAreaKindSchema>;

export const ACTOR_TYPES = ['user', 'system', 'worker', 'portal', 'webhook', 'platform'] as const;
export const ActorTypeSchema = zEnum(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const OUTBOX_STATUSES = ['pending', 'dispatched', 'failed', 'dead'] as const;
export const OutboxStatusSchema = zEnum(OUTBOX_STATUSES);
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;

export const IDEMPOTENCY_STATUSES = ['in_progress', 'completed'] as const;
export const IdempotencyStatusSchema = zEnum(IDEMPOTENCY_STATUSES);
export type IdempotencyStatus = z.infer<typeof IdempotencyStatusSchema>;

// ---------------------------------------------------------------- notifications, consent
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms'] as const;
export const NotificationChannelSchema = zEnum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

/** PLT-020 notification taxonomy. */
export const NOTIFICATION_CATEGORIES = [
  'roof_report_review',
  'curb_photos_unusable',
  'estimate_approved',
  'proposal_viewed',
  'signature_received',
  'payment_settled',
  'invitation',
  'dispatch',
  'permit_expiring',
  'system',
] as const;
export const NotificationCategorySchema = zEnum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export const NOTIFICATION_DELIVERY_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'failed',
  'suppressed',
] as const;
export const NotificationDeliveryStatusSchema = zEnum(NOTIFICATION_DELIVERY_STATUSES);
export type NotificationDeliveryStatus = z.infer<typeof NotificationDeliveryStatusSchema>;

export const CONSENT_KINDS = [
  'email_transactional',
  'email_marketing',
  'sms',
  'photo_processing',
  'portal_terms',
  'electronic_signature',
] as const;
export const ConsentKindSchema = zEnum(CONSENT_KINDS);
export type ConsentKind = z.infer<typeof ConsentKindSchema>;

export const CONSENT_STATUSES = ['granted', 'withdrawn'] as const;
export const ConsentStatusSchema = zEnum(CONSENT_STATUSES);
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

// ---------------------------------------------------------------- CRM, jobs
export const CUSTOMER_KINDS = ['person', 'business'] as const;
export const CustomerKindSchema = zEnum(CUSTOMER_KINDS);
export type CustomerKind = z.infer<typeof CustomerKindSchema>;

export const RECORD_STATUSES = ['active', 'archived', 'merged'] as const;
export const RecordStatusSchema = zEnum(RECORD_STATUSES);
export type RecordStatus = z.infer<typeof RecordStatusSchema>;

export const LEAD_SOURCES = [
  'web_form',
  'manual',
  'phone',
  'curb_photo_submission',
  'roof_address',
  'referral',
  'import',
  'other',
] as const;
export const LeadSourceSchema = zEnum(LEAD_SOURCES);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'converted',
  'disqualified',
  'merged',
] as const;
export const LeadStatusSchema = zEnum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const JOB_STATUSES = ['open', 'on_hold', 'closed', 'cancelled'] as const;
export const JobStatusSchema = zEnum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JOB_STAGE_CATEGORIES = ['open', 'won', 'lost', 'closed'] as const;
export const JobStageCategorySchema = zEnum(JOB_STAGE_CATEGORIES);
export type JobStageCategory = z.infer<typeof JobStageCategorySchema>;

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const PrioritySchema = zEnum(PRIORITIES);
export type Priority = z.infer<typeof PrioritySchema>;

export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export const TaskStatusSchema = zEnum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** Records that notes, tasks and attachments can hang off (generic owner). */
export const SUBJECT_TYPES = [
  'customer',
  'contact',
  'lead',
  'property',
  'job',
  'roof_order',
  'roof_report',
  'curb_project',
  'estimate',
  'proposal',
  'invoice',
  'change_order',
  'organization',
] as const;
export const SubjectTypeSchema = zEnum(SUBJECT_TYPES);
export type SubjectType = z.infer<typeof SubjectTypeSchema>;

// ---------------------------------------------------------------- properties, jurisdictions
export const STRUCTURE_KINDS = [
  'main_house',
  'attached_garage',
  'detached_garage',
  'shed',
  'outbuilding',
  'multifamily_unit',
  'commercial_building',
  'other',
] as const;
export const StructureKindSchema = zEnum(STRUCTURE_KINDS);
export type StructureKind = z.infer<typeof StructureKindSchema>;

/** RF-024: a tree-covered shed may stay `unmeasured` instead of getting invented dimensions. */
export const STRUCTURE_SCOPE_STATUSES = ['included', 'excluded', 'unmeasured'] as const;
export const StructureScopeStatusSchema = zEnum(STRUCTURE_SCOPE_STATUSES);
export type StructureScopeStatus = z.infer<typeof StructureScopeStatusSchema>;

export const JURISDICTION_KINDS = [
  'city',
  'county',
  'state',
  'special_district',
  'unincorporated',
  'other',
] as const;
export const JurisdictionKindSchema = zEnum(JURISDICTION_KINDS);
export type JurisdictionKind = z.infer<typeof JurisdictionKindSchema>;

/** CP-056: published guidance stays `draft` until a compliance admin verifies it. */
export const JURISDICTION_STATUSES = ['draft', 'verified', 'retired'] as const;
export const JurisdictionStatusSchema = zEnum(JURISDICTION_STATUSES);
export type JurisdictionStatus = z.infer<typeof JurisdictionStatusSchema>;

// ---------------------------------------------------------------- imagery
export const IMAGERY_PROVIDERS = [
  'fixture',
  'esri_world_imagery',
  'google_map_tiles',
  'contractor_upload',
] as const;
export const ImageryProviderSchema = zEnum(IMAGERY_PROVIDERS);
export type ImageryProvider = z.infer<typeof ImageryProviderSchema>;

export const IMAGERY_KINDS = ['orthophoto', 'oblique', 'drone_photo', 'blueprint', 'site_photo'] as const;
export const ImageryKindSchema = zEnum(IMAGERY_KINDS);
export type ImageryKind = z.infer<typeof ImageryKindSchema>;

export const IMAGERY_STATUSES = ['candidate', 'selected', 'ingested', 'rejected', 'expired'] as const;
export const ImageryStatusSchema = zEnum(IMAGERY_STATUSES);
export type ImageryStatus = z.infer<typeof ImageryStatusSchema>;

// ---------------------------------------------------------------- roof
export const ROOF_ORDER_MODES = ['diy', 'assisted'] as const;
export const RoofOrderModeSchema = zEnum(ROOF_ORDER_MODES);
export type RoofOrderMode = z.infer<typeof RoofOrderModeSchema>;

export const ROOF_DELIVERY_SPEEDS = ['instant_diy', 'standard', 'priority'] as const;
export const RoofDeliverySpeedSchema = zEnum(ROOF_DELIVERY_SPEEDS);
export type RoofDeliverySpeed = z.infer<typeof RoofDeliverySpeedSchema>;

/**
 * RF-021 / page 006 + page 039. One status set covers fulfilment and the commercial journey; the
 * customer-facing delivery label (page 039 names) is derived in machines.ts.
 */
export const ROOF_ORDER_STATUSES = [
  'draft',
  'ordered',
  'imagery_pending',
  'measuring',
  'review_required',
  'clarification_needed',
  'approved',
  'quoted',
  'won',
  'invoiced',
  'paid',
  'failed',
  'refunded',
  'cancelled',
] as const;
export const RoofOrderStatusSchema = zEnum(ROOF_ORDER_STATUSES);
export type RoofOrderStatus = z.infer<typeof RoofOrderStatusSchema>;

export const ROOF_REPORT_STATUSES = ['drafting', 'in_review', 'approved', 'issued', 'cancelled'] as const;
export const RoofReportStatusSchema = zEnum(ROOF_REPORT_STATUSES);
export type RoofReportStatus = z.infer<typeof RoofReportStatusSchema>;

/** RR-037: a version is editable only while `draft`; every later state is an immutable snapshot. */
export const ROOF_REPORT_VERSION_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'issued',
  'superseded',
  'rejected',
] as const;
export const RoofReportVersionStatusSchema = zEnum(ROOF_REPORT_VERSION_STATUSES);
export type RoofReportVersionStatus = z.infer<typeof RoofReportVersionStatusSchema>;
export const LOCKED_ROOF_REPORT_VERSION_STATUSES = [
  'submitted',
  'approved',
  'issued',
  'superseded',
  'rejected',
] as const satisfies readonly RoofReportVersionStatus[];

/** RF-025 UX-B: flat roofs, dormers, voids and parapets are explicit, not forced into pitched. */
export const ROOF_SURFACE_TYPES = [
  'pitched',
  'flat',
  'dormer',
  'skylight_void',
  'chimney_void',
  'equipment_void',
  'parapet',
  'nonplanar',
] as const;
export const RoofSurfaceTypeSchema = zEnum(ROOF_SURFACE_TYPES);
export type RoofSurfaceType = z.infer<typeof RoofSurfaceTypeSchema>;

/** RF-028 edge taxonomy. */
export const ROOF_EDGE_TYPES = [
  'eave',
  'rake',
  'ridge',
  'hip',
  'valley',
  'flashing',
  'step_flashing',
  'perimeter',
  'unclassified',
] as const;
export const RoofEdgeTypeSchema = zEnum(ROOF_EDGE_TYPES);
export type RoofEdgeType = z.infer<typeof RoofEdgeTypeSchema>;

/** RF-030 / STR-010 provenance labels for every dimension. */
export const MEASUREMENT_SOURCES = [
  'machine_estimated',
  'imagery_derived',
  'user_entered',
  'field_verified',
  'survey_supplied',
] as const;
export const MeasurementSourceSchema = zEnum(MEASUREMENT_SOURCES);
export type MeasurementSource = z.infer<typeof MeasurementSourceSchema>;

export const MATERIAL_CLASSES = [
  'shingles',
  'underlayment',
  'starter',
  'ridge_cap',
  'drip_edge',
  'valley',
  'flashing',
  'vents',
  'accessories',
  'other',
] as const;
export const MaterialClassSchema = zEnum(MATERIAL_CLASSES);
export type MaterialClass = z.infer<typeof MaterialClassSchema>;

/** RR-035: a waste rate is a rule recommendation or a human-entered value with explanation. */
export const WASTE_SOURCES = ['rule_recommendation', 'human_entered'] as const;
export const WasteSourceSchema = zEnum(WASTE_SOURCES);
export type WasteSource = z.infer<typeof WasteSourceSchema>;

export const EXPORT_FORMATS = ['pdf', 'csv', 'json', 'esx'] as const;
export const ExportFormatSchema = zEnum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const EXPORT_STATUSES = ['pending', 'completed', 'failed', 'unsupported'] as const;
export const ExportStatusSchema = zEnum(EXPORT_STATUSES);
export type ExportStatus = z.infer<typeof ExportStatusSchema>;

// ---------------------------------------------------------------- review queue
export const REVIEW_TASK_KINDS = [
  'roof_measurement',
  'roof_second_review',
  'curb_estimate',
  'curb_field_check',
  'price_check',
  'permit_review',
  'safety_review',
] as const;
export const ReviewTaskKindSchema = zEnum(REVIEW_TASK_KINDS);
export type ReviewTaskKind = z.infer<typeof ReviewTaskKindSchema>;

export const REVIEW_TASK_STATUSES = [
  'open',
  'claimed',
  'awaiting_second_review',
  'completed',
  'escalated',
  'cancelled',
] as const;
export const ReviewTaskStatusSchema = zEnum(REVIEW_TASK_STATUSES);
export type ReviewTaskStatus = z.infer<typeof ReviewTaskStatusSchema>;

export const REVIEW_DECISIONS = [
  'approved',
  'changes_requested',
  'rejected',
  'recapture_requested',
  'clarification_requested',
  'escalated',
] as const;
export const ReviewDecisionSchema = zEnum(REVIEW_DECISIONS);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

// ---------------------------------------------------------------- curb
/** CV-041 service taxonomy. `other_concrete_cut` always goes to human scoping. */
export const CURB_SERVICE_CODES = [
  'driveway_opening',
  'curb_shaving',
  'curb_removal_replacement',
  'gutter_replacement',
  'sidewalk_ramp_transition',
  'private_curb_cut',
  'other_concrete_cut',
] as const;
export const CurbServiceCodeSchema = zEnum(CURB_SERVICE_CODES);
export type CurbServiceCode = z.infer<typeof CurbServiceCodeSchema>;

export const CURB_PROJECT_STATUSES = [
  'intake',
  'capture',
  'calibration',
  'measurement',
  'estimating',
  'review',
  'approved',
  'scheduled',
  'completed',
  'cancelled',
] as const;
export const CurbProjectStatusSchema = zEnum(CURB_PROJECT_STATUSES);
export type CurbProjectStatus = z.infer<typeof CurbProjectStatusSchema>;

/** CV-046 profile categories; `unknown` is a real answer, never a default to a priced profile. */
export const CURB_PROFILES = [
  'curb_and_gutter',
  'barrier_curb',
  'mountable_curb',
  'integral_curb',
  'landscape_curb',
  'unknown',
] as const;
export const CurbProfileSchema = zEnum(CURB_PROFILES);
export type CurbProfile = z.infer<typeof CurbProfileSchema>;

export const CURB_SEGMENT_KINDS = [
  'saw_cut_path',
  'removal_footprint',
  'return_transition',
  'driveway_replacement',
  'sidewalk_replacement',
  'obstruction',
  'protected_asset',
] as const;
export const CurbSegmentKindSchema = zEnum(CURB_SEGMENT_KINDS);
export type CurbSegmentKind = z.infer<typeof CurbSegmentKindSchema>;

/** CV-045 D: projected length, height, thickness and unobservable buried depth stay separate. */
export const CURB_MEASUREMENT_KINDS = [
  'cut_length',
  'cut_depth',
  'saw_pass_count',
  'curb_height',
  'curb_width',
  'gutter_width',
  'thickness',
  'buried_depth',
  'removal_area',
  'removal_volume',
  'replacement_length',
  'restoration_area',
  'roadway_grade',
  'cross_slope',
  'driveway_rise',
] as const;
export const CurbMeasurementKindSchema = zEnum(CURB_MEASUREMENT_KINDS);
export type CurbMeasurementKind = z.infer<typeof CurbMeasurementKindSchema>;

export const RISK_FLAG_KINDS = [
  'public_right_of_way',
  'underground_utility_risk',
  'utility_conflict',
  'drainage_impact',
  'road_work_permit',
  'external_engineering',
  'accessible_route',
  'traffic_control',
  'silica_exposure',
  'unknown_depth',
  'unknown_reinforcement',
  'jurisdiction_unresolved',
  'overlapping_jurisdiction',
  'unsafe_pedestrian_access',
  'scope_ambiguous',
] as const;
export const RiskFlagKindSchema = zEnum(RISK_FLAG_KINDS);
export type RiskFlagKind = z.infer<typeof RiskFlagKindSchema>;

export const RISK_SEVERITIES = ['info', 'warning', 'blocking'] as const;
export const RiskSeveritySchema = zEnum(RISK_SEVERITIES);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

export const RISK_FLAG_STATUSES = ['open', 'mitigated', 'resolved', 'dismissed'] as const;
export const RiskFlagStatusSchema = zEnum(RISK_FLAG_STATUSES);
export type RiskFlagStatus = z.infer<typeof RiskFlagStatusSchema>;

/** Where a risk flag or observation came from (CV-049 B: detected vs verified record). */
export const EVIDENCE_SOURCES = [
  'visual_detection',
  'customer_answer',
  'estimator_entry',
  'field_check',
  'utility_locate',
  'authority_record',
  'survey',
  'rule_engine',
] as const;
export const EvidenceSourceSchema = zEnum(EVIDENCE_SOURCES);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

/** CP-056: permits are requirements with status; `unknown` holds approval and opens a city task. */
export const PERMIT_STATUSES = [
  'unknown',
  'not_required',
  'required',
  'application_prepared',
  'submitted',
  'approved',
  'rejected',
  'expired',
] as const;
export const PermitStatusSchema = zEnum(PERMIT_STATUSES);
export type PermitStatus = z.infer<typeof PermitStatusSchema>;

export const SAFETY_REVIEW_KINDS = [
  'job_site_safety_plan',
  'traffic_control_plan',
  'silica_exposure_control',
  'pedestrian_access',
  'utility_clearance',
  'competent_person',
] as const;
export const SafetyReviewKindSchema = zEnum(SAFETY_REVIEW_KINDS);
export type SafetyReviewKind = z.infer<typeof SafetyReviewKindSchema>;

export const SAFETY_REVIEW_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'not_applicable',
] as const;
export const SafetyReviewStatusSchema = zEnum(SAFETY_REVIEW_STATUSES);
export type SafetyReviewStatus = z.infer<typeof SafetyReviewStatusSchema>;

// ---------------------------------------------------------------- media
export const MEDIA_OWNER_TYPES = [
  'curb_project',
  'roof_order',
  'roof_report',
  'property',
  'job',
  'proposal',
  'change_order',
  'note',
  'customer',
  'organization',
] as const;
export const MediaOwnerTypeSchema = zEnum(MEDIA_OWNER_TYPES);
export type MediaOwnerType = z.infer<typeof MediaOwnerTypeSchema>;

export const MEDIA_KINDS = ['photo', 'video', 'document', 'blueprint', 'drone_image', 'export'] as const;
export const MediaKindSchema = zEnum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/** CV-043 requested view types. */
export const MEDIA_VIEW_TYPES = [
  'overview_straight_on',
  'wide_approach',
  'top_view',
  'end_cross_section',
  'scale_reference',
  'gutter',
  'sidewalk',
  'driveway_slope',
  'adjoining_pavement',
  'utility_feature',
  'traffic_context',
  'roof_photo',
  'blueprint_sheet',
  'other',
] as const;
export const MediaViewTypeSchema = zEnum(MEDIA_VIEW_TYPES);
export type MediaViewType = z.infer<typeof MediaViewTypeSchema>;

export const MEDIA_STATUSES = [
  'pending_upload',
  'uploaded',
  'processing',
  'ready',
  'rejected',
  'deleted',
] as const;
export const MediaStatusSchema = zEnum(MEDIA_STATUSES);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

/** `not_scanned` is honest: the dev scanner is a no-op and says so. */
export const MEDIA_SCAN_STATUSES = ['not_scanned', 'pending', 'clean', 'infected', 'failed'] as const;
export const MediaScanStatusSchema = zEnum(MEDIA_SCAN_STATUSES);
export type MediaScanStatus = z.infer<typeof MediaScanStatusSchema>;

export const REDACTION_KINDS = ['face', 'license_plate', 'neighbor_property', 'text', 'other'] as const;
export const RedactionKindSchema = zEnum(REDACTION_KINDS);
export type RedactionKind = z.infer<typeof RedactionKindSchema>;

export const UPLOAD_SESSION_STATUSES = ['pending', 'completed', 'expired', 'rejected'] as const;
export const UploadSessionStatusSchema = zEnum(UPLOAD_SESSION_STATUSES);
export type UploadSessionStatus = z.infer<typeof UploadSessionStatusSchema>;

export const CALIBRATION_METHODS = [
  'two_point_reference',
  'four_point_homography',
  'depth_sensor',
  'survey_drawing',
  'field_dimensions',
  'blueprint_known_dimension',
] as const;
export const CalibrationMethodSchema = zEnum(CALIBRATION_METHODS);
export type CalibrationMethod = z.infer<typeof CalibrationMethodSchema>;

/** CV-045 S: an unreliable reference fails explicitly and routes to manual dimensions. */
export const CALIBRATION_STATUSES = ['pending', 'accepted', 'failed', 'superseded'] as const;
export const CalibrationStatusSchema = zEnum(CALIBRATION_STATUSES);
export type CalibrationStatus = z.infer<typeof CalibrationStatusSchema>;

// ---------------------------------------------------------------- approvals
export const APPROVAL_SUBJECT_TYPES = [
  'estimate_revision',
  'price_book_revision',
  'roof_report_version',
  'proposal_version',
  'invoice',
  'change_order',
  'discount_override',
  'refund',
  'dispatch',
  'permit_requirement',
  'safety_review',
] as const;
export const ApprovalSubjectTypeSchema = zEnum(APPROVAL_SUBJECT_TYPES);
export type ApprovalSubjectType = z.infer<typeof ApprovalSubjectTypeSchema>;

/** CP-059 named sign-off roles (a capacity in which someone approves, not an RBAC role). */
export const SIGNOFF_ROLES = [
  'field_verifier',
  'estimator',
  'project_manager',
  'permit_reviewer',
  'qualified_professional',
  'finance_approver',
  'owner',
] as const;
export const SignoffRoleSchema = zEnum(SIGNOFF_ROLES);
export type SignoffRole = z.infer<typeof SignoffRoleSchema>;

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export const ApprovalDecisionSchema = zEnum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

// ---------------------------------------------------------------- estimates, pricing
/** CV-050 statuses, shared by roof and curb estimates. */
export const ESTIMATE_STATUSES = [
  'draft_ai',
  'calibration_required',
  'review_required',
  'field_check_required',
  'pricing_ready',
  'approved',
  'rejected',
] as const;
export const EstimateStatusSchema = zEnum(ESTIMATE_STATUSES);
export type EstimateStatus = z.infer<typeof EstimateStatusSchema>;

/**
 * What a priced result may be shown as. Only `firm` is binding, and only when the gating result
 * has no blockers (CP-059: no preliminary estimate can be labeled a fixed-price offer).
 */
export const QUOTE_KINDS = ['budgetary_range', 'review_required', 'firm'] as const;
export const QuoteKindSchema = zEnum(QUOTE_KINDS);
export type QuoteKind = z.infer<typeof QuoteKindSchema>;

export const SCENARIOS = ['low', 'base', 'high'] as const;
export const ScenarioSchema = zEnum(SCENARIOS);
export type Scenario = z.infer<typeof ScenarioSchema>;

export const PRICE_BOOK_STATUSES = ['active', 'archived'] as const;
export const PriceBookStatusSchema = zEnum(PRICE_BOOK_STATUSES);
export type PriceBookStatus = z.infer<typeof PriceBookStatusSchema>;

/** CP-057: approved revisions are immutable; a change is a new revision. */
export const PRICE_BOOK_REVISION_STATUSES = ['draft', 'pending_approval', 'approved', 'retired'] as const;
export const PriceBookRevisionStatusSchema = zEnum(PRICE_BOOK_REVISION_STATUSES);
export type PriceBookRevisionStatus = z.infer<typeof PriceBookRevisionStatusSchema>;

/** CP-054 D: financial tracking categories. */
export const PRICE_ITEM_CATEGORIES = [
  'labor',
  'material',
  'disposal',
  'equipment',
  'subcontract',
  'permit',
  'traffic_control',
  'mobilization',
  'allowance',
  'fee',
] as const;
export const PriceItemCategorySchema = zEnum(PRICE_ITEM_CATEGORIES);
export type PriceItemCategory = z.infer<typeof PriceItemCategorySchema>;

/** Curb direct-cost components (non-negotiable formula: their sum is direct cost). */
export const COST_COMPONENTS = [
  'mobilization',
  'cutting',
  'demolition',
  'disposal',
  'restoration',
  'traffic',
  'permits',
  'other_allowance',
  'roof_material',
  'roof_labor',
] as const;
export const CostComponentSchema = zEnum(COST_COMPONENTS);
export type CostComponent = z.infer<typeof CostComponentSchema>;

/**
 * Commercial pricing units. Quantities are canonical SI; the pricing engine converts a quantity
 * into the item's pricing unit with exact factors (1 ft = 0.3048 m) before multiplying.
 */
export const PRICING_UNITS = [
  'each',
  'lump_sum',
  'linear_ft',
  'linear_m',
  'sq_ft',
  'sq_m',
  'sq_yd',
  'cu_ft',
  'cu_yd',
  'cu_m',
  'roofing_square',
  'hour',
  'day',
  'ton',
  'load',
  'bundle',
  'roll',
] as const;
export const PricingUnitSchema = zEnum(PRICING_UNITS);
export type PricingUnit = z.infer<typeof PricingUnitSchema>;

/** OPS-065: markup on cost vs target gross margin (selling = cost / (1 - m)); never both. */
export const MARGIN_STRATEGIES = ['markup', 'target_margin'] as const;
export const MarginStrategySchema = zEnum(MARGIN_STRATEGIES);
export type MarginStrategy = z.infer<typeof MarginStrategySchema>;

// ---------------------------------------------------------------- proposals, signatures
export const PROPOSAL_STATUSES = [
  'draft',
  'pending_approval',
  'ready_to_send',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
  'voided',
] as const;
export const ProposalStatusSchema = zEnum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

/** A version is immutable once it leaves `draft` (OPS-063). */
export const PROPOSAL_VERSION_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'superseded'] as const;
export const ProposalVersionStatusSchema = zEnum(PROPOSAL_VERSION_STATUSES);
export type ProposalVersionStatus = z.infer<typeof ProposalVersionStatusSchema>;

export const PROPOSAL_OPTION_KINDS = ['package', 'add_on'] as const;
export const ProposalOptionKindSchema = zEnum(PROPOSAL_OPTION_KINDS);
export type ProposalOptionKind = z.infer<typeof ProposalOptionKindSchema>;

export const PROPOSAL_TIERS = ['basic', 'standard', 'premium', 'custom'] as const;
export const ProposalTierSchema = zEnum(PROPOSAL_TIERS);
export type ProposalTier = z.infer<typeof ProposalTierSchema>;

export const SIGNATURE_PROVIDERS = ['internal', 'stand_in'] as const;
export const SignatureProviderSchema = zEnum(SIGNATURE_PROVIDERS);
export type SignatureProvider = z.infer<typeof SignatureProviderSchema>;

export const SIGNATURE_ENVELOPE_STATUSES = [
  'draft',
  'sent',
  'partially_signed',
  'completed',
  'declined',
  'voided',
  'expired',
] as const;
export const SignatureEnvelopeStatusSchema = zEnum(SIGNATURE_ENVELOPE_STATUSES);
export type SignatureEnvelopeStatus = z.infer<typeof SignatureEnvelopeStatusSchema>;

export const SIGNATURE_EVENT_TYPES = [
  'created',
  'sent',
  'viewed',
  'consented',
  'signed',
  'declined',
  'voided',
  'expired',
  'reminder_sent',
  'resent',
  'completed',
] as const;
export const SignatureEventTypeSchema = zEnum(SIGNATURE_EVENT_TYPES);
export type SignatureEventType = z.infer<typeof SignatureEventTypeSchema>;

export const CONTRACT_STATUSES = ['active', 'amended', 'completed', 'cancelled'] as const;
export const ContractStatusSchema = zEnum(CONTRACT_STATUSES);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

// ---------------------------------------------------------------- invoices, payments, ledger
export const INVOICE_STATUSES = [
  'draft',
  'pending_approval',
  'issued',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
  'void',
  'uncollectible',
] as const;
export const InvoiceStatusSchema = zEnum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const INVOICE_KINDS = ['deposit', 'progress', 'final', 'change_order', 'standalone'] as const;
export const InvoiceKindSchema = zEnum(INVOICE_KINDS);
export type InvoiceKind = z.infer<typeof InvoiceKindSchema>;

export const PAYMENT_STATUSES = [
  'pending',
  'requires_action',
  'processing',
  'succeeded',
  'failed',
  'canceled',
  'partially_refunded',
  'refunded',
] as const;
export const PaymentStatusSchema = zEnum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PAYMENT_METHODS = ['card', 'bank_transfer', 'check', 'cash', 'other'] as const;
export const PaymentMethodSchema = zEnum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

/** `stand_in` is the test provider; it is never presented as a live processor. */
export const PAYMENT_PROVIDERS = ['stripe', 'manual', 'stand_in'] as const;
export const PaymentProviderSchema = zEnum(PAYMENT_PROVIDERS);
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

export const LEDGER_ACCOUNTS = [
  'accounts_receivable',
  'cash',
  'processor_fees',
  'refunds',
  'customer_credit',
  'tax_payable',
  'revenue',
] as const;
export const LedgerAccountSchema = zEnum(LEDGER_ACCOUNTS);
export type LedgerAccount = z.infer<typeof LedgerAccountSchema>;

export const LEDGER_DIRECTIONS = ['debit', 'credit'] as const;
export const LedgerDirectionSchema = zEnum(LEDGER_DIRECTIONS);
export type LedgerDirection = z.infer<typeof LedgerDirectionSchema>;

export const CHANGE_ORDER_STATUSES = [
  'draft',
  'pending_internal_approval',
  'sent_to_customer',
  'accepted',
  'rejected',
  'withdrawn',
] as const;
export const ChangeOrderStatusSchema = zEnum(CHANGE_ORDER_STATUSES);
export type ChangeOrderStatus = z.infer<typeof ChangeOrderStatusSchema>;

export const PORTAL_TOKEN_SCOPES = ['proposal', 'invoice', 'report', 'job', 'upload_request'] as const;
export const PortalTokenScopeSchema = zEnum(PORTAL_TOKEN_SCOPES);
export type PortalTokenScope = z.infer<typeof PortalTokenScopeSchema>;

// ---------------------------------------------------------------- operations
/** OPS-066 B: an internal order is never assumed accepted by the supplier. */
export const SUPPLIER_ORDER_STATUSES = [
  'draft',
  'pending_acknowledgment',
  'submitted',
  'confirmed',
  'partially_delivered',
  'delivered',
  'cancelled',
  'rejected',
] as const;
export const SupplierOrderStatusSchema = zEnum(SUPPLIER_ORDER_STATUSES);
export type SupplierOrderStatus = z.infer<typeof SupplierOrderStatusSchema>;

export const CREW_TRADES = ['roofing', 'curb_cutting', 'concrete', 'general'] as const;
export const CrewTradeSchema = zEnum(CREW_TRADES);
export type CrewTrade = z.infer<typeof CrewTradeSchema>;

export const SCHEDULE_STATUSES = ['tentative', 'confirmed', 'cancelled', 'completed'] as const;
export const ScheduleStatusSchema = zEnum(SCHEDULE_STATUSES);
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;

export const DISPATCH_STATUSES = [
  'planned',
  'blocked',
  'released',
  'acknowledged',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export const DispatchStatusSchema = zEnum(DISPATCH_STATUSES);
export type DispatchStatus = z.infer<typeof DispatchStatusSchema>;

/** BE-079 credit ledger entry kinds (`granted` adds purchased or plan credits). */
export const USAGE_ENTRY_KINDS = [
  'granted',
  'reserved',
  'consumed',
  'released',
  'refunded',
  'expired',
] as const;
export const UsageEntryKindSchema = zEnum(USAGE_ENTRY_KINDS);
export type UsageEntryKind = z.infer<typeof UsageEntryKindSchema>;

export const USAGE_METERS = [
  'roof_report',
  'imagery_credit',
  'curb_ai_analysis',
  'human_review',
  'pdf_export',
] as const;
export const UsageMeterSchema = zEnum(USAGE_METERS);
export type UsageMeter = z.infer<typeof UsageMeterSchema>;

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'paused', 'canceled'] as const;
export const SubscriptionStatusSchema = zEnum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const BILLING_INTERVALS = ['month', 'year'] as const;
export const BillingIntervalSchema = zEnum(BILLING_INTERVALS);
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;

// ---------------------------------------------------------------- AI / models
/** AIQ-090 promotion phases. */
export const MODEL_STAGES = ['dev', 'shadow', 'limited_pilot', 'production', 'retired'] as const;
export const ModelStageSchema = zEnum(MODEL_STAGES);
export type ModelStage = z.infer<typeof ModelStageSchema>;

export const MODEL_TASKS = [
  'roof_facet_detection',
  'roof_pitch_estimation',
  'curb_detection',
  'curb_profile_classification',
  'photo_quality',
] as const;
export const ModelTaskSchema = zEnum(MODEL_TASKS);
export type ModelTask = z.infer<typeof ModelTaskSchema>;

/** AIQ-087: `abstained` is an explicit result type, not a low score. */
export const INFERENCE_OUTCOMES = ['suggested', 'abstained', 'failed'] as const;
export const InferenceOutcomeSchema = zEnum(INFERENCE_OUTCOMES);
export type InferenceOutcome = z.infer<typeof InferenceOutcomeSchema>;

export const INTEGRATION_KINDS = [
  'imagery',
  'geocoding',
  'email',
  'sms',
  'payment',
  'signature',
  'supplier',
  'accounting',
  'insurance_export',
] as const;
export const IntegrationKindSchema = zEnum(INTEGRATION_KINDS);
export type IntegrationKind = z.infer<typeof IntegrationKindSchema>;

export const INTEGRATION_STATUSES = [
  'not_configured',
  'connected',
  'degraded',
  'error',
  'disabled',
] as const;
export const IntegrationStatusSchema = zEnum(INTEGRATION_STATUSES);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;
