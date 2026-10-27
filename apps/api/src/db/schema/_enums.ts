// Postgres enums generated from the @fieldline/contracts tuples, so the API, web app and database
// share one list. Changing a tuple requires a new migration (npm run db:generate).
import {
  MEMBER_ROLES,
  ORG_STATUSES,
  PRODUCT_LINES,
  MEASUREMENT_SYSTEMS,
  USER_STATUSES,
  IDENTITY_PROVIDERS,
  MEMBERSHIP_STATUSES,
  INVITATION_STATUSES,
  PERMISSION_EFFECTS,
  SERVICE_AREA_KINDS,
  ACTOR_TYPES,
  OUTBOX_STATUSES,
  IDEMPOTENCY_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_DELIVERY_STATUSES,
  CONSENT_KINDS,
  CONSENT_STATUSES,
  CUSTOMER_KINDS,
  RECORD_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  JOB_STATUSES,
  JOB_STAGE_CATEGORIES,
  PRIORITIES,
  TASK_STATUSES,
  SUBJECT_TYPES,
  STRUCTURE_KINDS,
  STRUCTURE_SCOPE_STATUSES,
  JURISDICTION_KINDS,
  JURISDICTION_STATUSES,
  IMAGERY_PROVIDERS,
  IMAGERY_KINDS,
  IMAGERY_STATUSES,
  ROOF_ORDER_MODES,
  ROOF_DELIVERY_SPEEDS,
  ROOF_ORDER_STATUSES,
  ROOF_REPORT_STATUSES,
  ROOF_REPORT_VERSION_STATUSES,
  ROOF_SURFACE_TYPES,
  ROOF_EDGE_TYPES,
  MEASUREMENT_SOURCES,
  MATERIAL_CLASSES,
  WASTE_SOURCES,
  EXPORT_FORMATS,
  EXPORT_STATUSES,
  REVIEW_TASK_KINDS,
  REVIEW_TASK_STATUSES,
  REVIEW_DECISIONS,
  CURB_SERVICE_CODES,
  CURB_PROJECT_STATUSES,
  CURB_PROFILES,
  CURB_SEGMENT_KINDS,
  CURB_MEASUREMENT_KINDS,
  RISK_FLAG_KINDS,
  RISK_SEVERITIES,
  RISK_FLAG_STATUSES,
  EVIDENCE_SOURCES,
  PERMIT_STATUSES,
  SAFETY_REVIEW_KINDS,
  SAFETY_REVIEW_STATUSES,
  MEDIA_OWNER_TYPES,
  MEDIA_KINDS,
  MEDIA_VIEW_TYPES,
  MEDIA_STATUSES,
  MEDIA_SCAN_STATUSES,
  REDACTION_KINDS,
  UPLOAD_SESSION_STATUSES,
  CALIBRATION_METHODS,
  CALIBRATION_STATUSES,
  APPROVAL_SUBJECT_TYPES,
  SIGNOFF_ROLES,
  APPROVAL_DECISIONS,
  ESTIMATE_STATUSES,
  QUOTE_KINDS,
  SCENARIOS,
  PRICE_BOOK_STATUSES,
  PRICE_BOOK_REVISION_STATUSES,
  PRICE_ITEM_CATEGORIES,
  COST_COMPONENTS,
  PRICING_UNITS,
  MARGIN_STRATEGIES,
  PROPOSAL_STATUSES,
  PROPOSAL_VERSION_STATUSES,
  PROPOSAL_OPTION_KINDS,
  PROPOSAL_TIERS,
  SIGNATURE_PROVIDERS,
  SIGNATURE_ENVELOPE_STATUSES,
  SIGNATURE_EVENT_TYPES,
  CONTRACT_STATUSES,
  INVOICE_STATUSES,
  INVOICE_KINDS,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  LEDGER_ACCOUNTS,
  LEDGER_DIRECTIONS,
  CHANGE_ORDER_STATUSES,
  PORTAL_TOKEN_SCOPES,
  SUPPLIER_ORDER_STATUSES,
  CREW_TRADES,
  SCHEDULE_STATUSES,
  DISPATCH_STATUSES,
  USAGE_ENTRY_KINDS,
  USAGE_METERS,
  SUBSCRIPTION_STATUSES,
  BILLING_INTERVALS,
  MODEL_STAGES,
  MODEL_TASKS,
  INFERENCE_OUTCOMES,
  INTEGRATION_KINDS,
  INTEGRATION_STATUSES,
} from '@fieldline/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

export const memberRoleEnum = pgEnum('member_role', MEMBER_ROLES);
export const orgStatusEnum = pgEnum('org_status', ORG_STATUSES);
export const productLineEnum = pgEnum('product_line', PRODUCT_LINES);
export const measurementSystemEnum = pgEnum('measurement_system', MEASUREMENT_SYSTEMS);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const identityProviderEnum = pgEnum('identity_provider', IDENTITY_PROVIDERS);
export const membershipStatusEnum = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const invitationStatusEnum = pgEnum('invitation_status', INVITATION_STATUSES);
export const permissionEffectEnum = pgEnum('permission_effect', PERMISSION_EFFECTS);
export const serviceAreaKindEnum = pgEnum('service_area_kind', SERVICE_AREA_KINDS);
export const actorTypeEnum = pgEnum('actor_type', ACTOR_TYPES);
export const outboxStatusEnum = pgEnum('outbox_status', OUTBOX_STATUSES);
export const idempotencyStatusEnum = pgEnum('idempotency_status', IDEMPOTENCY_STATUSES);
export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationCategoryEnum = pgEnum('notification_category', NOTIFICATION_CATEGORIES);
export const notificationDeliveryStatusEnum = pgEnum('notification_delivery_status', NOTIFICATION_DELIVERY_STATUSES);
export const consentKindEnum = pgEnum('consent_kind', CONSENT_KINDS);
export const consentStatusEnum = pgEnum('consent_status', CONSENT_STATUSES);
export const customerKindEnum = pgEnum('customer_kind', CUSTOMER_KINDS);
export const recordStatusEnum = pgEnum('record_status', RECORD_STATUSES);
export const leadSourceEnum = pgEnum('lead_source', LEAD_SOURCES);
export const leadStatusEnum = pgEnum('lead_status', LEAD_STATUSES);
export const jobStatusEnum = pgEnum('job_status', JOB_STATUSES);
export const jobStageCategoryEnum = pgEnum('job_stage_category', JOB_STAGE_CATEGORIES);
export const priorityEnum = pgEnum('priority', PRIORITIES);
export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);
export const subjectTypeEnum = pgEnum('subject_type', SUBJECT_TYPES);
export const structureKindEnum = pgEnum('structure_kind', STRUCTURE_KINDS);
export const structureScopeStatusEnum = pgEnum('structure_scope_status', STRUCTURE_SCOPE_STATUSES);
export const jurisdictionKindEnum = pgEnum('jurisdiction_kind', JURISDICTION_KINDS);
export const jurisdictionStatusEnum = pgEnum('jurisdiction_status', JURISDICTION_STATUSES);
export const imageryProviderEnum = pgEnum('imagery_provider', IMAGERY_PROVIDERS);
export const imageryKindEnum = pgEnum('imagery_kind', IMAGERY_KINDS);
export const imageryStatusEnum = pgEnum('imagery_status', IMAGERY_STATUSES);
export const roofOrderModeEnum = pgEnum('roof_order_mode', ROOF_ORDER_MODES);
export const roofDeliverySpeedEnum = pgEnum('roof_delivery_speed', ROOF_DELIVERY_SPEEDS);
export const roofOrderStatusEnum = pgEnum('roof_order_status', ROOF_ORDER_STATUSES);
export const roofReportStatusEnum = pgEnum('roof_report_status', ROOF_REPORT_STATUSES);
export const roofReportVersionStatusEnum = pgEnum('roof_report_version_status', ROOF_REPORT_VERSION_STATUSES);
export const roofSurfaceTypeEnum = pgEnum('roof_surface_type', ROOF_SURFACE_TYPES);
export const roofEdgeTypeEnum = pgEnum('roof_edge_type', ROOF_EDGE_TYPES);
export const measurementSourceEnum = pgEnum('measurement_source', MEASUREMENT_SOURCES);
export const materialClassEnum = pgEnum('material_class', MATERIAL_CLASSES);
export const wasteSourceEnum = pgEnum('waste_source', WASTE_SOURCES);
export const exportFormatEnum = pgEnum('export_format', EXPORT_FORMATS);
export const exportStatusEnum = pgEnum('export_status', EXPORT_STATUSES);
export const reviewTaskKindEnum = pgEnum('review_task_kind', REVIEW_TASK_KINDS);
export const reviewTaskStatusEnum = pgEnum('review_task_status', REVIEW_TASK_STATUSES);
export const reviewDecisionEnum = pgEnum('review_decision', REVIEW_DECISIONS);
export const curbServiceCodeEnum = pgEnum('curb_service_code', CURB_SERVICE_CODES);
export const curbProjectStatusEnum = pgEnum('curb_project_status', CURB_PROJECT_STATUSES);
export const curbProfileEnum = pgEnum('curb_profile', CURB_PROFILES);
export const curbSegmentKindEnum = pgEnum('curb_segment_kind', CURB_SEGMENT_KINDS);
export const curbMeasurementKindEnum = pgEnum('curb_measurement_kind', CURB_MEASUREMENT_KINDS);
export const riskFlagKindEnum = pgEnum('risk_flag_kind', RISK_FLAG_KINDS);
export const riskSeverityEnum = pgEnum('risk_severity', RISK_SEVERITIES);
export const riskFlagStatusEnum = pgEnum('risk_flag_status', RISK_FLAG_STATUSES);
export const evidenceSourceEnum = pgEnum('evidence_source', EVIDENCE_SOURCES);
export const permitStatusEnum = pgEnum('permit_status', PERMIT_STATUSES);
export const safetyReviewKindEnum = pgEnum('safety_review_kind', SAFETY_REVIEW_KINDS);
export const safetyReviewStatusEnum = pgEnum('safety_review_status', SAFETY_REVIEW_STATUSES);
export const mediaOwnerTypeEnum = pgEnum('media_owner_type', MEDIA_OWNER_TYPES);
export const mediaKindEnum = pgEnum('media_kind', MEDIA_KINDS);
export const mediaViewTypeEnum = pgEnum('media_view_type', MEDIA_VIEW_TYPES);
export const mediaStatusEnum = pgEnum('media_status', MEDIA_STATUSES);
export const mediaScanStatusEnum = pgEnum('media_scan_status', MEDIA_SCAN_STATUSES);
export const redactionKindEnum = pgEnum('redaction_kind', REDACTION_KINDS);
export const uploadSessionStatusEnum = pgEnum('upload_session_status', UPLOAD_SESSION_STATUSES);
export const calibrationMethodEnum = pgEnum('calibration_method', CALIBRATION_METHODS);
export const calibrationStatusEnum = pgEnum('calibration_status', CALIBRATION_STATUSES);
export const approvalSubjectTypeEnum = pgEnum('approval_subject_type', APPROVAL_SUBJECT_TYPES);
export const signoffRoleEnum = pgEnum('signoff_role', SIGNOFF_ROLES);
export const approvalDecisionEnum = pgEnum('approval_decision', APPROVAL_DECISIONS);
export const estimateStatusEnum = pgEnum('estimate_status', ESTIMATE_STATUSES);
export const quoteKindEnum = pgEnum('quote_kind', QUOTE_KINDS);
export const scenarioEnum = pgEnum('scenario', SCENARIOS);
export const priceBookStatusEnum = pgEnum('price_book_status', PRICE_BOOK_STATUSES);
export const priceBookRevisionStatusEnum = pgEnum('price_book_revision_status', PRICE_BOOK_REVISION_STATUSES);
export const priceItemCategoryEnum = pgEnum('price_item_category', PRICE_ITEM_CATEGORIES);
export const costComponentEnum = pgEnum('cost_component', COST_COMPONENTS);
export const pricingUnitEnum = pgEnum('pricing_unit', PRICING_UNITS);
export const marginStrategyEnum = pgEnum('margin_strategy', MARGIN_STRATEGIES);
export const proposalStatusEnum = pgEnum('proposal_status', PROPOSAL_STATUSES);
export const proposalVersionStatusEnum = pgEnum('proposal_version_status', PROPOSAL_VERSION_STATUSES);
export const proposalOptionKindEnum = pgEnum('proposal_option_kind', PROPOSAL_OPTION_KINDS);
export const proposalTierEnum = pgEnum('proposal_tier', PROPOSAL_TIERS);
export const signatureProviderEnum = pgEnum('signature_provider', SIGNATURE_PROVIDERS);
export const signatureEnvelopeStatusEnum = pgEnum('signature_envelope_status', SIGNATURE_ENVELOPE_STATUSES);
export const signatureEventTypeEnum = pgEnum('signature_event_type', SIGNATURE_EVENT_TYPES);
export const contractStatusEnum = pgEnum('contract_status', CONTRACT_STATUSES);
export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);
export const invoiceKindEnum = pgEnum('invoice_kind', INVOICE_KINDS);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentProviderEnum = pgEnum('payment_provider', PAYMENT_PROVIDERS);
export const ledgerAccountEnum = pgEnum('ledger_account', LEDGER_ACCOUNTS);
export const ledgerDirectionEnum = pgEnum('ledger_direction', LEDGER_DIRECTIONS);
export const changeOrderStatusEnum = pgEnum('change_order_status', CHANGE_ORDER_STATUSES);
export const portalTokenScopeEnum = pgEnum('portal_token_scope', PORTAL_TOKEN_SCOPES);
export const supplierOrderStatusEnum = pgEnum('supplier_order_status', SUPPLIER_ORDER_STATUSES);
export const crewTradeEnum = pgEnum('crew_trade', CREW_TRADES);
export const scheduleStatusEnum = pgEnum('schedule_status', SCHEDULE_STATUSES);
export const dispatchStatusEnum = pgEnum('dispatch_status', DISPATCH_STATUSES);
export const usageEntryKindEnum = pgEnum('usage_entry_kind', USAGE_ENTRY_KINDS);
export const usageMeterEnum = pgEnum('usage_meter', USAGE_METERS);
export const subscriptionStatusEnum = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
export const billingIntervalEnum = pgEnum('billing_interval', BILLING_INTERVALS);
export const modelStageEnum = pgEnum('model_stage', MODEL_STAGES);
export const modelTaskEnum = pgEnum('model_task', MODEL_TASKS);
export const inferenceOutcomeEnum = pgEnum('inference_outcome', INFERENCE_OUTCOMES);
export const integrationKindEnum = pgEnum('integration_kind', INTEGRATION_KINDS);
export const integrationStatusEnum = pgEnum('integration_status', INTEGRATION_STATUSES);
