CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'worker', 'portal', 'webhook', 'platform');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."approval_subject_type" AS ENUM('estimate_revision', 'price_book_revision', 'roof_report_version', 'proposal_version', 'invoice', 'change_order', 'discount_override', 'refund', 'dispatch', 'permit_requirement', 'safety_review');--> statement-breakpoint
CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."calibration_method" AS ENUM('two_point_reference', 'four_point_homography', 'depth_sensor', 'survey_drawing', 'field_dimensions', 'blueprint_known_dimension');--> statement-breakpoint
CREATE TYPE "public"."calibration_status" AS ENUM('pending', 'accepted', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."change_order_status" AS ENUM('draft', 'pending_internal_approval', 'sent_to_customer', 'accepted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."consent_kind" AS ENUM('email_transactional', 'email_marketing', 'sms', 'photo_processing', 'portal_terms', 'electronic_signature');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('active', 'amended', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cost_component" AS ENUM('mobilization', 'cutting', 'demolition', 'disposal', 'restoration', 'traffic', 'permits', 'other_allowance', 'roof_material', 'roof_labor');--> statement-breakpoint
CREATE TYPE "public"."crew_trade" AS ENUM('roofing', 'curb_cutting', 'concrete', 'general');--> statement-breakpoint
CREATE TYPE "public"."curb_measurement_kind" AS ENUM('cut_length', 'cut_depth', 'saw_pass_count', 'curb_height', 'curb_width', 'gutter_width', 'thickness', 'buried_depth', 'removal_area', 'removal_volume', 'replacement_length', 'restoration_area', 'roadway_grade', 'cross_slope', 'driveway_rise');--> statement-breakpoint
CREATE TYPE "public"."curb_profile" AS ENUM('curb_and_gutter', 'barrier_curb', 'mountable_curb', 'integral_curb', 'landscape_curb', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."curb_project_status" AS ENUM('intake', 'capture', 'calibration', 'measurement', 'estimating', 'review', 'approved', 'scheduled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."curb_segment_kind" AS ENUM('saw_cut_path', 'removal_footprint', 'return_transition', 'driveway_replacement', 'sidewalk_replacement', 'obstruction', 'protected_asset');--> statement-breakpoint
CREATE TYPE "public"."curb_service_code" AS ENUM('driveway_opening', 'curb_shaving', 'curb_removal_replacement', 'gutter_replacement', 'sidewalk_ramp_transition', 'private_curb_cut', 'other_concrete_cut');--> statement-breakpoint
CREATE TYPE "public"."customer_kind" AS ENUM('person', 'business');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('planned', 'blocked', 'released', 'acknowledged', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."estimate_status" AS ENUM('draft_ai', 'calibration_required', 'review_required', 'field_check_required', 'pricing_ready', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('visual_detection', 'customer_answer', 'estimator_entry', 'field_check', 'utility_locate', 'authority_record', 'survey', 'rule_engine');--> statement-breakpoint
CREATE TYPE "public"."export_format" AS ENUM('pdf', 'csv', 'json', 'esx');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('pending', 'completed', 'failed', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."identity_provider" AS ENUM('microsoft', 'dev_idp', 'email_link');--> statement-breakpoint
CREATE TYPE "public"."imagery_kind" AS ENUM('orthophoto', 'oblique', 'drone_photo', 'blueprint', 'site_photo');--> statement-breakpoint
CREATE TYPE "public"."imagery_provider" AS ENUM('fixture', 'esri_world_imagery', 'google_map_tiles', 'contractor_upload');--> statement-breakpoint
CREATE TYPE "public"."imagery_status" AS ENUM('candidate', 'selected', 'ingested', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."inference_outcome" AS ENUM('suggested', 'abstained', 'failed');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('imagery', 'geocoding', 'email', 'sms', 'payment', 'signature', 'supplier', 'accounting', 'insurance_export');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('not_configured', 'connected', 'degraded', 'error', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('deposit', 'progress', 'final', 'change_order', 'standalone');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'pending_approval', 'issued', 'partially_paid', 'paid', 'partially_refunded', 'refunded', 'void', 'uncollectible');--> statement-breakpoint
CREATE TYPE "public"."job_stage_category" AS ENUM('open', 'won', 'lost', 'closed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('open', 'on_hold', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_kind" AS ENUM('city', 'county', 'state', 'special_district', 'unincorporated', 'other');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_status" AS ENUM('draft', 'verified', 'retired');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('web_form', 'manual', 'phone', 'curb_photo_submission', 'roof_address', 'referral', 'import', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'converted', 'disqualified', 'merged');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('accounts_receivable', 'cash', 'processor_fees', 'refunds', 'customer_credit', 'tax_payable', 'revenue');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."margin_strategy" AS ENUM('markup', 'target_margin');--> statement-breakpoint
CREATE TYPE "public"."material_class" AS ENUM('shingles', 'underlayment', 'starter', 'ridge_cap', 'drip_edge', 'valley', 'flashing', 'vents', 'accessories', 'other');--> statement-breakpoint
CREATE TYPE "public"."measurement_source" AS ENUM('machine_estimated', 'imagery_derived', 'user_entered', 'field_verified', 'survey_supplied');--> statement-breakpoint
CREATE TYPE "public"."measurement_system" AS ENUM('imperial', 'metric');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('photo', 'video', 'document', 'blueprint', 'drone_image', 'export');--> statement-breakpoint
CREATE TYPE "public"."media_owner_type" AS ENUM('curb_project', 'roof_order', 'roof_report', 'property', 'job', 'proposal', 'change_order', 'note', 'customer', 'organization');--> statement-breakpoint
CREATE TYPE "public"."media_scan_status" AS ENUM('not_scanned', 'pending', 'clean', 'infected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending_upload', 'uploaded', 'processing', 'ready', 'rejected', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."media_view_type" AS ENUM('overview_straight_on', 'wide_approach', 'top_view', 'end_cross_section', 'scale_reference', 'gutter', 'sidewalk', 'driveway_slope', 'adjoining_pavement', 'utility_feature', 'traffic_context', 'roof_photo', 'blueprint_sheet', 'other');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'estimator', 'reviewer', 'salesperson', 'crew_manager', 'finance', 'read_only');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."model_stage" AS ENUM('dev', 'shadow', 'limited_pilot', 'production', 'retired');--> statement-breakpoint
CREATE TYPE "public"."model_task" AS ENUM('roof_facet_detection', 'roof_pitch_estimation', 'curb_detection', 'curb_profile_classification', 'photo_quality');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('roof_report_review', 'curb_photos_unusable', 'estimate_approved', 'proposal_viewed', 'signature_received', 'payment_settled', 'invitation', 'dispatch', 'permit_expiring', 'system');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'dispatched', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'bank_transfer', 'check', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'manual', 'stand_in');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'requires_action', 'processing', 'succeeded', 'failed', 'canceled', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."permission_effect" AS ENUM('grant', 'deny');--> statement-breakpoint
CREATE TYPE "public"."permit_status" AS ENUM('unknown', 'not_required', 'required', 'application_prepared', 'submitted', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."portal_token_scope" AS ENUM('proposal', 'invoice', 'report', 'job', 'upload_request');--> statement-breakpoint
CREATE TYPE "public"."price_book_revision_status" AS ENUM('draft', 'pending_approval', 'approved', 'retired');--> statement-breakpoint
CREATE TYPE "public"."price_book_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."price_item_category" AS ENUM('labor', 'material', 'disposal', 'equipment', 'subcontract', 'permit', 'traffic_control', 'mobilization', 'allowance', 'fee');--> statement-breakpoint
CREATE TYPE "public"."pricing_unit" AS ENUM('each', 'lump_sum', 'linear_ft', 'linear_m', 'sq_ft', 'sq_m', 'sq_yd', 'cu_ft', 'cu_yd', 'cu_m', 'roofing_square', 'hour', 'day', 'ton', 'load', 'bundle', 'roll');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."product_line" AS ENUM('roof', 'curb');--> statement-breakpoint
CREATE TYPE "public"."proposal_option_kind" AS ENUM('package', 'add_on');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'pending_approval', 'ready_to_send', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'voided');--> statement-breakpoint
CREATE TYPE "public"."proposal_tier" AS ENUM('basic', 'standard', 'premium', 'custom');--> statement-breakpoint
CREATE TYPE "public"."proposal_version_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."quote_kind" AS ENUM('budgetary_range', 'review_required', 'firm');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('active', 'archived', 'merged');--> statement-breakpoint
CREATE TYPE "public"."redaction_kind" AS ENUM('face', 'license_plate', 'neighbor_property', 'text', 'other');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approved', 'changes_requested', 'rejected', 'recapture_requested', 'clarification_requested', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."review_task_kind" AS ENUM('roof_measurement', 'roof_second_review', 'curb_estimate', 'curb_field_check', 'price_check', 'permit_review', 'safety_review');--> statement-breakpoint
CREATE TYPE "public"."review_task_status" AS ENUM('open', 'claimed', 'awaiting_second_review', 'completed', 'escalated', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."risk_flag_kind" AS ENUM('public_right_of_way', 'underground_utility_risk', 'utility_conflict', 'drainage_impact', 'road_work_permit', 'external_engineering', 'accessible_route', 'traffic_control', 'silica_exposure', 'unknown_depth', 'unknown_reinforcement', 'jurisdiction_unresolved', 'overlapping_jurisdiction', 'unsafe_pedestrian_access', 'scope_ambiguous');--> statement-breakpoint
CREATE TYPE "public"."risk_flag_status" AS ENUM('open', 'mitigated', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."risk_severity" AS ENUM('info', 'warning', 'blocking');--> statement-breakpoint
CREATE TYPE "public"."roof_delivery_speed" AS ENUM('instant_diy', 'standard', 'priority');--> statement-breakpoint
CREATE TYPE "public"."roof_edge_type" AS ENUM('eave', 'rake', 'ridge', 'hip', 'valley', 'flashing', 'step_flashing', 'perimeter', 'unclassified');--> statement-breakpoint
CREATE TYPE "public"."roof_order_mode" AS ENUM('diy', 'assisted');--> statement-breakpoint
CREATE TYPE "public"."roof_order_status" AS ENUM('draft', 'ordered', 'imagery_pending', 'measuring', 'review_required', 'clarification_needed', 'approved', 'quoted', 'won', 'invoiced', 'paid', 'failed', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."roof_report_status" AS ENUM('drafting', 'in_review', 'approved', 'issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."roof_report_version_status" AS ENUM('draft', 'submitted', 'approved', 'issued', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."roof_surface_type" AS ENUM('pitched', 'flat', 'dormer', 'skylight_void', 'chimney_void', 'equipment_void', 'parapet', 'nonplanar');--> statement-breakpoint
CREATE TYPE "public"."safety_review_kind" AS ENUM('job_site_safety_plan', 'traffic_control_plan', 'silica_exposure_control', 'pedestrian_access', 'utility_clearance', 'competent_person');--> statement-breakpoint
CREATE TYPE "public"."safety_review_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."scenario" AS ENUM('low', 'base', 'high');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('tentative', 'confirmed', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."service_area_kind" AS ENUM('state', 'metro', 'county', 'city', 'custom');--> statement-breakpoint
CREATE TYPE "public"."signature_envelope_status" AS ENUM('draft', 'sent', 'partially_signed', 'completed', 'declined', 'voided', 'expired');--> statement-breakpoint
CREATE TYPE "public"."signature_event_type" AS ENUM('created', 'sent', 'viewed', 'consented', 'signed', 'declined', 'voided', 'expired', 'reminder_sent', 'resent', 'completed');--> statement-breakpoint
CREATE TYPE "public"."signature_provider" AS ENUM('internal', 'stand_in');--> statement-breakpoint
CREATE TYPE "public"."signoff_role" AS ENUM('field_verifier', 'estimator', 'project_manager', 'permit_reviewer', 'qualified_professional', 'finance_approver', 'owner');--> statement-breakpoint
CREATE TYPE "public"."structure_kind" AS ENUM('main_house', 'attached_garage', 'detached_garage', 'shed', 'outbuilding', 'multifamily_unit', 'commercial_building', 'other');--> statement-breakpoint
CREATE TYPE "public"."structure_scope_status" AS ENUM('included', 'excluded', 'unmeasured');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('customer', 'contact', 'lead', 'property', 'job', 'roof_order', 'roof_report', 'curb_project', 'estimate', 'proposal', 'invoice', 'change_order', 'organization');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'paused', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."supplier_order_status" AS ENUM('draft', 'pending_acknowledgment', 'submitted', 'confirmed', 'partially_delivered', 'delivered', 'cancelled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."upload_session_status" AS ENUM('pending', 'completed', 'expired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."usage_entry_kind" AS ENUM('granted', 'reserved', 'consumed', 'released', 'refunded', 'expired');--> statement-breakpoint
CREATE TYPE "public"."usage_meter" AS ENUM('roof_report', 'imagery_credit', 'curb_ai_analysis', 'human_review', 'pdf_export');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."waste_source" AS ENUM('rule_recommendation', 'human_entered');--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"email_at_login" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"active_org_id" uuid,
	"identity_id" uuid,
	"user_agent" text,
	"ip_hash" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"rotated_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"timezone" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_settings_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision_number" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"change_reason" text,
	"changed_by_user_id" uuid,
	CONSTRAINT "org_settings_revisions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "org_status" DEFAULT 'active' NOT NULL,
	"product_lines" "product_line"[] DEFAULT '{}' NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"measurement_system" "measurement_system" DEFAULT 'imperial' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_uq" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"kind" "service_area_kind" DEFAULT 'custom' NOT NULL,
	"product_lines" "product_line"[] DEFAULT '{}' NOT NULL,
	"boundary" geometry(MultiPolygon,4326) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "service_areas_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_membership_id" uuid NOT NULL,
	"to_membership_id" uuid NOT NULL,
	"subject_types" "approval_subject_type"[] NOT NULL,
	"max_amount_minor" bigint,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"revoked_at" timestamp with time zone,
	"conditions" jsonb,
	CONSTRAINT "approval_delegations_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invitations_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"title" text,
	"role_bundle_id" uuid,
	"invited_by_user_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memberships_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"membership_id" uuid NOT NULL,
	"action" text NOT NULL,
	"effect" "permission_effect" NOT NULL,
	"reason" text,
	"granted_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	CONSTRAINT "permission_overrides_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "role_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_role" "member_role" NOT NULL,
	"actions" text[] DEFAULT '{}' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "role_bundles_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"jurisdiction_id" uuid,
	"key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"rollout_note" text,
	"config" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"correlation_id" text,
	"ip_hash" text,
	"user_agent" text,
	CONSTRAINT "audit_events_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"last_error" text,
	"correlation_id" text,
	CONSTRAINT "domain_events_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"response_status" smallint,
	"response_body" jsonb,
	"actor_user_id" uuid,
	"locked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_type" "media_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "media_kind" DEFAULT 'photo' NOT NULL,
	"view_type" "media_view_type",
	"status" "media_status" DEFAULT 'pending_upload' NOT NULL,
	"original_object_key" text NOT NULL,
	"sanitized_object_key" text,
	"thumbnail_object_key" text,
	"file_name" text,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width_px" integer,
	"height_px" integer,
	"captured_at" timestamp with time zone,
	"exif_restricted" jsonb,
	"quality_scores" jsonb,
	"quality_passed" boolean,
	"blur_score" numeric(6, 4),
	"scan_status" "media_scan_status" DEFAULT 'not_scanned' NOT NULL,
	"consent_id" uuid,
	"uploaded_by_user_id" uuid,
	"uploaded_via_portal" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_assets_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "media_redactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"kind" "redaction_kind" NOT NULL,
	"region" jsonb NOT NULL,
	"automatic" boolean DEFAULT false NOT NULL,
	"confirmed_by_user_id" uuid,
	CONSTRAINT "media_redactions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_type" "media_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"expected_mime_type" text NOT NULL,
	"max_bytes" bigint NOT NULL,
	"status" "upload_session_status" DEFAULT 'pending' NOT NULL,
	"media_asset_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "upload_sessions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject_type" "subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"media_asset_id" uuid,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"label" text,
	"uploaded_by_user_id" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attachments_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "imagery_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"property_id" uuid NOT NULL,
	"provider" "imagery_provider" NOT NULL,
	"provider_image_id" text,
	"kind" "imagery_kind" DEFAULT 'orthophoto' NOT NULL,
	"status" "imagery_status" DEFAULT 'candidate' NOT NULL,
	"rights" jsonb NOT NULL,
	"attribution" text NOT NULL,
	"gsd_m" numeric(10, 5),
	"capture_date" date,
	"georef" jsonb,
	"footprint" geometry(Polygon,4326),
	"width_px" integer,
	"height_px" integer,
	"object_key" text,
	"media_asset_id" uuid,
	"expires_at" timestamp with time zone,
	"cost" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "imagery_assets_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "jurisdiction_kind" NOT NULL,
	"status" "jurisdiction_status" DEFAULT 'draft' NOT NULL,
	"parent_id" uuid,
	"country_code" text DEFAULT 'US' NOT NULL,
	"region" text,
	"boundary" geometry(MultiPolygon,4326),
	"rules_version" text DEFAULT '0' NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"label" text,
	"original_query" text NOT NULL,
	"line1" text,
	"line2" text,
	"locality" text,
	"region" text,
	"postal_code" text,
	"country_code" text DEFAULT 'US' NOT NULL,
	"normalized_address" text,
	"geocoder_provider" text,
	"geocoder_place_id" text,
	"geocode_confidence" numeric(4, 3),
	"geocoded_at" timestamp with time zone,
	"location" geography(Point,4326),
	"confirmed_location" geography(Point,4326),
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"parcel_id" text,
	"jurisdiction_id" uuid,
	"is_fictional" boolean DEFAULT false NOT NULL,
	"notes" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "properties_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"property_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" "structure_kind" DEFAULT 'main_house' NOT NULL,
	"scope_status" "structure_scope_status" DEFAULT 'included' NOT NULL,
	"footprint" geometry(Polygon,4326),
	"stories" integer,
	"year_built" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"observed_on" date,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "structures_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "material_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"material_class" "material_class" NOT NULL,
	"manufacturer" text,
	"coverage_quantity" numeric(18, 6) NOT NULL,
	"coverage_unit" text NOT NULL,
	"purchase_unit" text NOT NULL,
	"unit_cost_minor" bigint,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "material_catalog_items_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "material_takeoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_version_id" uuid NOT NULL,
	"waste_policy_id" uuid,
	"waste_fraction" numeric(18, 6) NOT NULL,
	"waste_source" "waste_source" NOT NULL,
	"lines" jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"created_by_user_id" uuid,
	CONSTRAINT "material_takeoffs_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "measurement_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"field" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb NOT NULL,
	"unit" text,
	"source" "measurement_source" NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" uuid,
	"supersedes_id" uuid,
	CONSTRAINT "measurement_overrides_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roof_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"from_vertex_key" text NOT NULL,
	"to_vertex_key" text NOT NULL,
	"left_facet_key" text,
	"right_facet_key" text,
	"edge_type" "roof_edge_type" DEFAULT 'unclassified' NOT NULL,
	"classification_source" "measurement_source",
	"length_m" numeric(18, 6),
	CONSTRAINT "roof_edges_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roof_facets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text,
	"surface_type" "roof_surface_type" DEFAULT 'pitched' NOT NULL,
	"vertex_keys" text[] NOT NULL,
	"pitch_rise" numeric(8, 4),
	"pitch_run" numeric(8, 4) DEFAULT '12',
	"pitch_ratio" numeric(18, 6),
	"pitch_source" "measurement_source",
	"azimuth_deg" double precision,
	"plan_area_m2" numeric(18, 6),
	"sloped_area_m2" numeric(18, 6),
	"area_source" "measurement_source",
	"parent_facet_key" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	CONSTRAINT "roof_facets_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roof_geometry_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_version_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"op" text NOT NULL,
	"payload" jsonb NOT NULL,
	"base_geometry_revision" integer NOT NULL,
	"actor_user_id" uuid,
	"client_op_id" text,
	CONSTRAINT "roof_geometry_ops_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roof_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"roof_order_id" uuid NOT NULL,
	"from_status" "roof_order_status",
	"to_status" "roof_order_status" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"data" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" text,
	CONSTRAINT "roof_order_events_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roof_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"property_id" uuid NOT NULL,
	"job_id" uuid,
	"mode" "roof_order_mode" NOT NULL,
	"delivery_speed" "roof_delivery_speed" DEFAULT 'standard' NOT NULL,
	"status" "roof_order_status" DEFAULT 'draft' NOT NULL,
	"structure_ids" uuid[] DEFAULT '{}' NOT NULL,
	"imagery_asset_id" uuid,
	"requested_by_membership_id" uuid,
	"instructions" text,
	"due_at" timestamp with time zone,
	"price_minor" bigint,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"usage_reservation_id" uuid,
	"failure_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roof_orders_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roof_report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"roof_report_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "roof_report_version_status" DEFAULT 'draft' NOT NULL,
	"geometry_revision" integer DEFAULT 0 NOT NULL,
	"geometry" jsonb,
	"totals" jsonb,
	"georef" jsonb,
	"crs" text DEFAULT 'LOCAL_ENU_M' NOT NULL,
	"imagery_asset_id" uuid,
	"engine_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation" jsonb,
	"unresolved_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"supersedes_version_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roof_report_versions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roof_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"roof_order_id" uuid NOT NULL,
	"structure_id" uuid,
	"status" "roof_report_status" DEFAULT 'drafting' NOT NULL,
	"current_version_id" uuid,
	"issued_version_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roof_reports_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roof_vertices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"z" double precision,
	"source" "measurement_source" DEFAULT 'user_entered' NOT NULL,
	CONSTRAINT "roof_vertices_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "waste_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"rules" jsonb NOT NULL,
	"default_waste_fraction" numeric(18, 6) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "waste_policies_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "calibrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curb_project_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"method" "calibration_method" NOT NULL,
	"status" "calibration_status" DEFAULT 'pending' NOT NULL,
	"reference_label" text,
	"reference_length_m" numeric(18, 6),
	"control_points" jsonb NOT NULL,
	"meters_per_pixel" numeric(18, 6),
	"residual_error_m" numeric(18, 6),
	"uncertainty" numeric(6, 4),
	"created_by_user_id" uuid,
	"supersedes_id" uuid,
	CONSTRAINT "calibrations_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "curb_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curb_project_id" uuid NOT NULL,
	"segment_id" uuid,
	"kind" "curb_measurement_kind" NOT NULL,
	"state" text NOT NULL,
	"value" numeric(18, 6),
	"unit" text,
	"low" numeric(18, 6),
	"high" numeric(18, 6),
	"source" "measurement_source",
	"calibration_id" uuid,
	"media_asset_id" uuid,
	"unknown_reason" text,
	"measured_at" timestamp with time zone,
	"measured_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "curb_measurements_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "curb_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curb_project_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"state" text NOT NULL,
	"value_text" text,
	"value_number" numeric(18, 6),
	"value_boolean" boolean,
	"value_json" jsonb,
	"unit" text,
	"unknown_reason" text,
	"source" "measurement_source",
	"evidence_source" "evidence_source",
	"media_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"answered_by_user_id" uuid,
	"answered_via_portal" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "curb_observations_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "curb_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"property_id" uuid NOT NULL,
	"job_id" uuid,
	"customer_id" uuid,
	"contact_id" uuid,
	"service_code" "curb_service_code" NOT NULL,
	"status" "curb_project_status" DEFAULT 'intake' NOT NULL,
	"jurisdiction_id" uuid,
	"jurisdiction_rules_version" text,
	"curb_profile" "curb_profile" DEFAULT 'unknown' NOT NULL,
	"is_public_right_of_way" boolean,
	"site_location" geometry(Point,4326),
	"description" text,
	"assigned_membership_id" uuid,
	"requested_start_on" date,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "curb_projects_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "curb_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curb_project_id" uuid NOT NULL,
	"kind" "curb_segment_kind" NOT NULL,
	"label" text,
	"path" geometry(LineString,4326),
	"footprint" geometry(Polygon,4326),
	"image_geometry" jsonb,
	"media_asset_id" uuid,
	"calibration_id" uuid,
	"source" "measurement_source" DEFAULT 'user_entered' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "curb_segments_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "permit_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curb_project_id" uuid NOT NULL,
	"jurisdiction_id" uuid,
	"rules_version" text,
	"permit_type" text NOT NULL,
	"status" "permit_status" DEFAULT 'unknown' NOT NULL,
	"application_reference" text,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"expires_on" date,
	"evidence" jsonb,
	"notes" text,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "permit_requirements_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "risk_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curb_project_id" uuid NOT NULL,
	"kind" "risk_flag_kind" NOT NULL,
	"severity" "risk_severity" NOT NULL,
	"status" "risk_flag_status" DEFAULT 'open' NOT NULL,
	"evidence_source" "evidence_source" NOT NULL,
	"evidence" jsonb,
	"rule_version" text,
	"message" text NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "risk_flags_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "safety_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curb_project_id" uuid NOT NULL,
	"kind" "safety_review_kind" NOT NULL,
	"status" "safety_review_status" DEFAULT 'pending' NOT NULL,
	"reviewer_membership_id" uuid,
	"checklist" jsonb,
	"evidence" jsonb,
	"reviewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "safety_reviews_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "price_book_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "price_book_revision_status" DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"overhead_rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"contingency_rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"margin_strategy" "margin_strategy" DEFAULT 'target_margin' NOT NULL,
	"margin_rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"minimum_charge_minor" bigint,
	"rounding_policy" jsonb,
	"notes" text,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "price_book_revisions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "price_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"product_line" "product_line" NOT NULL,
	"status" "price_book_status" DEFAULT 'active' NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"region" text,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "price_books_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "price_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_book_revision_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"category" "price_item_category" NOT NULL,
	"cost_component" "cost_component" NOT NULL,
	"unit" "pricing_unit" NOT NULL,
	"unit_rate" numeric(18, 6),
	"fixed_amount_minor" bigint,
	"minimum_quantity" numeric(18, 6),
	"taxable" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "price_items_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "production_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_book_revision_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"unit" "pricing_unit" NOT NULL,
	"units_per_hour" numeric(18, 6) NOT NULL,
	"crew_size" integer DEFAULT 1 NOT NULL,
	"conditions" jsonb,
	CONSTRAINT "production_rates_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "estimate_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"estimate_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "estimate_status" NOT NULL,
	"price_book_revision_id" uuid NOT NULL,
	"inputs" jsonb NOT NULL,
	"scenarios" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"low_total_minor" bigint NOT NULL,
	"high_total_minor" bigint NOT NULL,
	"engine_version" text NOT NULL,
	"gating_result" jsonb NOT NULL,
	"quote_kind" "quote_kind" NOT NULL,
	"is_binding" boolean DEFAULT false NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	CONSTRAINT "estimate_revisions_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "estimate_revisions_binding_ck" CHECK (not "estimate_revisions"."is_binding" or "estimate_revisions"."quote_kind" = 'firm'),
	CONSTRAINT "estimate_revisions_range_ck" CHECK ("estimate_revisions"."low_total_minor" <= "estimate_revisions"."total_minor" and "estimate_revisions"."total_minor" <= "estimate_revisions"."high_total_minor")
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"product_line" "product_line" NOT NULL,
	"curb_project_id" uuid,
	"roof_order_id" uuid,
	"job_id" uuid,
	"status" "estimate_status" DEFAULT 'draft_ai' NOT NULL,
	"current_revision_id" uuid,
	"approved_revision_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "estimates_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "estimates_subject_ck" CHECK ("estimates"."curb_project_id" is not null or "estimates"."roof_order_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject_type" "approval_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"signoff_role" "signoff_role" NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"approver_membership_id" uuid NOT NULL,
	"delegation_id" uuid,
	"rule_version" text NOT NULL,
	"evidence" jsonb,
	"amount_minor" bigint,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	CONSTRAINT "approvals_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_id" uuid,
	"first_name" text,
	"last_name" text,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"preferred_channel" text,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contacts_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "customer_kind" DEFAULT 'person' NOT NULL,
	"display_name" text NOT NULL,
	"company_name" text,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"merged_into_id" uuid,
	"billing_address" jsonb,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"external_ref" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "lead_source" NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"product_line" "product_line",
	"customer_id" uuid,
	"contact_id" uuid,
	"property_id" uuid,
	"assigned_membership_id" uuid,
	"summary" text,
	"estimated_value_minor" bigint,
	"dedupe_key" text,
	"merged_into_id" uuid,
	"disqualified_reason" text,
	"converted_at" timestamp with time zone,
	"raw_submission" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "leads_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject_type" "subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"author_membership_id" uuid,
	"body" text NOT NULL,
	"internal" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "notes_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject_type" "subject_type",
	"subject_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"assignee_membership_id" uuid,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tasks_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "crew_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"crew_id" uuid NOT NULL,
	"membership_id" uuid,
	"display_name" text NOT NULL,
	"certifications" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "crew_members_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"trade" "crew_trade" NOT NULL,
	"lead_membership_id" uuid,
	"capacity_per_day" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "crews_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid NOT NULL,
	"schedule_id" uuid,
	"crew_id" uuid NOT NULL,
	"status" "dispatch_status" DEFAULT 'planned' NOT NULL,
	"readiness" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blocked_reasons" text[] DEFAULT '{}' NOT NULL,
	"released_at" timestamp with time zone,
	"released_by_user_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "dispatches_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"data" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" text,
	CONSTRAINT "job_events_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "job_stage_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"category" "job_stage_category" NOT NULL,
	"sort_order" integer NOT NULL,
	"allowed_next" text[] DEFAULT '{}' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"product_line" "product_line",
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "job_stage_definitions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"product_line" "product_line" NOT NULL,
	"status" "job_status" DEFAULT 'open' NOT NULL,
	"stage_key" text NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"customer_id" uuid,
	"contact_id" uuid,
	"property_id" uuid,
	"lead_id" uuid,
	"owner_membership_id" uuid,
	"estimated_value_minor" bigint,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "jobs_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid NOT NULL,
	"crew_id" uuid,
	"status" "schedule_status" DEFAULT 'tentative' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"work_date" date,
	"notes" text,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "schedules_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "supplier_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid NOT NULL,
	"supplier_name" text NOT NULL,
	"status" "supplier_order_status" DEFAULT 'draft' NOT NULL,
	"reference" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_minor" bigint,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"requested_delivery_on" date,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_orders_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "proposal_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposal_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" "proposal_option_kind" NOT NULL,
	"tier" "proposal_tier",
	"label" text NOT NULL,
	"description" text,
	"estimate_revision_id" uuid,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_minor" bigint NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "proposal_options_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "proposal_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposal_version_id" uuid NOT NULL,
	"package_option_id" uuid NOT NULL,
	"add_on_option_ids" uuid[] DEFAULT '{}' NOT NULL,
	"total_minor" bigint NOT NULL,
	"selected_via" text NOT NULL,
	"selected_by_contact_id" uuid,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_selections_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "proposal_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "proposal_version_status" DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"terms_version" text,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_minor" bigint,
	"document_sha256" text,
	"pdf_object_key" text,
	"sent_at" timestamp with time zone,
	"sent_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "proposal_versions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"job_id" uuid,
	"customer_id" uuid NOT NULL,
	"contact_id" uuid,
	"title" text NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"accepted_version_id" uuid,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"expires_on" date,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "proposals_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"proposal_id" uuid NOT NULL,
	"proposal_version_id" uuid NOT NULL,
	"envelope_id" uuid,
	"job_id" uuid,
	"customer_id" uuid NOT NULL,
	"status" "contract_status" DEFAULT 'active' NOT NULL,
	"contract_value_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"document_sha256" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contracts_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "signature_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposal_version_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"provider" "signature_provider" DEFAULT 'internal' NOT NULL,
	"provider_envelope_id" text,
	"status" "signature_envelope_status" DEFAULT 'draft' NOT NULL,
	"document_sha256" text NOT NULL,
	"signers" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"signed_document_object_key" text,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "signature_envelopes_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "signature_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"event_type" "signature_event_type" NOT NULL,
	"signer_ref" text,
	"ip_hash" text,
	"user_agent" text,
	"document_sha256" text,
	"provider_event_id" text,
	"data" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_events_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit" "pricing_unit" DEFAULT 'each' NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"tax_rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"source_type" text,
	"source_id" uuid,
	CONSTRAINT "invoice_lines_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"contact_id" uuid,
	"job_id" uuid,
	"proposal_id" uuid,
	"contract_id" uuid,
	"change_order_id" uuid,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"amount_paid_minor" bigint DEFAULT 0 NOT NULL,
	"amount_refunded_minor" bigint DEFAULT 0 NOT NULL,
	"issued_on" date,
	"due_on" date,
	"issued_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"memo" text,
	"billing_address" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoices_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account" "ledger_account" NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"invoice_id" uuid,
	"payment_id" uuid,
	"customer_id" uuid,
	"memo" text,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_id" uuid,
	"provider" "payment_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_verified" text DEFAULT 'unverified' NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "payment_events_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_payment_id" text,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"idempotency_key" text,
	"received_at" timestamp with time zone,
	"failure_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payments_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "change_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"job_id" uuid NOT NULL,
	"contract_id" uuid,
	"status" "change_order_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_delta_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"schedule_impact_days" integer DEFAULT 0 NOT NULL,
	"estimate_revision_id" uuid,
	"envelope_id" uuid,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "change_orders_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "portal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_hash" text NOT NULL,
	"scope" "portal_token_scope" NOT NULL,
	"subject_id" uuid NOT NULL,
	"contact_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"created_by_user_id" uuid,
	CONSTRAINT "portal_tokens_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid,
	"membership_id" uuid,
	"kind" "consent_kind" NOT NULL,
	"status" "consent_status" NOT NULL,
	"source" text NOT NULL,
	"policy_version" text,
	"evidence" jsonb,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"membership_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_preferences_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipient_membership_id" uuid,
	"recipient_contact_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"category" "notification_category" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"subject_type" "subject_type",
	"subject_id" uuid,
	"data" jsonb,
	"delivery_status" "notification_delivery_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"dedupe_key" text,
	CONSTRAINT "notifications_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"limit_value" integer,
	"source" text NOT NULL,
	"subscription_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	CONSTRAINT "entitlements_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"interval" "billing_interval" NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"included_usage" jsonb NOT NULL,
	"features" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"provider_subscription_id" text,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at" timestamp with time zone,
	"seats" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "subscriptions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meter" "usage_meter" NOT NULL,
	"kind" "usage_entry_kind" NOT NULL,
	"quantity" integer NOT NULL,
	"reservation_id" uuid,
	"subject_type" text,
	"subject_id" uuid,
	"idempotency_key" text,
	"unit_price_minor" bigint,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "usage_ledger_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "usage_ledger_quantity_ck" CHECK ("usage_ledger"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "export_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"format" "export_format" NOT NULL,
	"status" "export_status" DEFAULT 'pending' NOT NULL,
	"template_version" text,
	"object_key" text,
	"sha256" text,
	"size_bytes" bigint,
	"options" jsonb,
	"error" text,
	"requested_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	CONSTRAINT "export_records_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "review_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "review_task_kind" NOT NULL,
	"status" "review_task_status" DEFAULT 'open' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"claimed_by_membership_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"requires_second_review" boolean DEFAULT false NOT NULL,
	"first_reviewer_membership_id" uuid,
	"second_reviewer_membership_id" uuid,
	"decision" "review_decision",
	"checklist" jsonb,
	"comments" text,
	"completed_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "review_tasks_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "inference_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model_id" uuid NOT NULL,
	"task" "model_task" NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"input_refs" jsonb NOT NULL,
	"outcome" "inference_outcome" NOT NULL,
	"output" jsonb,
	"confidence" numeric(5, 4),
	"abstain_reason" text,
	"latency_ms" numeric(10, 1),
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "inference_results_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "model_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" "model_task" NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"stage" "model_stage" DEFAULT 'dev' NOT NULL,
	"artifact_uri" text,
	"artifact_sha256" text,
	"training_data_ref" text,
	"metrics" jsonb,
	"abstain_below" numeric(5, 4),
	"license_notes" text,
	"promoted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_org_id_organizations_id_fk" FOREIGN KEY ("active_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_identity_id_external_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."external_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings_revisions" ADD CONSTRAINT "org_settings_revisions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_from_membership_id_fk" FOREIGN KEY ("org_id","from_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_to_membership_id_fk" FOREIGN KEY ("org_id","to_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_bundle_id_fk" FOREIGN KEY ("org_id","role_bundle_id") REFERENCES "public"."role_bundles"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_membership_id_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bundles" ADD CONSTRAINT "role_bundles_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_jurisdiction_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_consent_id_fk" FOREIGN KEY ("org_id","consent_id") REFERENCES "public"."consents"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_supersedes_id_fk" FOREIGN KEY ("org_id","supersedes_id") REFERENCES "public"."media_assets"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_redactions" ADD CONSTRAINT "media_redactions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_redactions" ADD CONSTRAINT "media_redactions_media_asset_id_fk" FOREIGN KEY ("org_id","media_asset_id") REFERENCES "public"."media_assets"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_media_asset_id_fk" FOREIGN KEY ("org_id","media_asset_id") REFERENCES "public"."media_assets"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_media_asset_id_fk" FOREIGN KEY ("org_id","media_asset_id") REFERENCES "public"."media_assets"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD CONSTRAINT "imagery_assets_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD CONSTRAINT "imagery_assets_property_id_fk" FOREIGN KEY ("org_id","property_id") REFERENCES "public"."properties"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imagery_assets" ADD CONSTRAINT "imagery_assets_media_asset_id_fk" FOREIGN KEY ("org_id","media_asset_id") REFERENCES "public"."media_assets"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structures" ADD CONSTRAINT "structures_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structures" ADD CONSTRAINT "structures_property_id_fk" FOREIGN KEY ("org_id","property_id") REFERENCES "public"."properties"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_catalog_items" ADD CONSTRAINT "material_catalog_items_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_takeoffs" ADD CONSTRAINT "material_takeoffs_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_takeoffs" ADD CONSTRAINT "material_takeoffs_report_version_id_fk" FOREIGN KEY ("org_id","report_version_id") REFERENCES "public"."roof_report_versions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_takeoffs" ADD CONSTRAINT "material_takeoffs_waste_policy_id_fk" FOREIGN KEY ("org_id","waste_policy_id") REFERENCES "public"."waste_policies"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_overrides" ADD CONSTRAINT "measurement_overrides_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_overrides" ADD CONSTRAINT "measurement_overrides_supersedes_id_fk" FOREIGN KEY ("org_id","supersedes_id") REFERENCES "public"."measurement_overrides"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_edges" ADD CONSTRAINT "roof_edges_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_edges" ADD CONSTRAINT "roof_edges_report_version_id_fk" FOREIGN KEY ("org_id","report_version_id") REFERENCES "public"."roof_report_versions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_facets" ADD CONSTRAINT "roof_facets_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_facets" ADD CONSTRAINT "roof_facets_report_version_id_fk" FOREIGN KEY ("org_id","report_version_id") REFERENCES "public"."roof_report_versions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_geometry_ops" ADD CONSTRAINT "roof_geometry_ops_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_geometry_ops" ADD CONSTRAINT "roof_geometry_ops_report_version_id_fk" FOREIGN KEY ("org_id","report_version_id") REFERENCES "public"."roof_report_versions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_order_events" ADD CONSTRAINT "roof_order_events_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_order_events" ADD CONSTRAINT "roof_order_events_roof_order_id_fk" FOREIGN KEY ("org_id","roof_order_id") REFERENCES "public"."roof_orders"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_orders" ADD CONSTRAINT "roof_orders_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_orders" ADD CONSTRAINT "roof_orders_property_id_fk" FOREIGN KEY ("org_id","property_id") REFERENCES "public"."properties"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_orders" ADD CONSTRAINT "roof_orders_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_orders" ADD CONSTRAINT "roof_orders_imagery_asset_id_fk" FOREIGN KEY ("org_id","imagery_asset_id") REFERENCES "public"."imagery_assets"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_orders" ADD CONSTRAINT "roof_orders_requested_by_membership_id_fk" FOREIGN KEY ("org_id","requested_by_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_report_versions" ADD CONSTRAINT "roof_report_versions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_report_versions" ADD CONSTRAINT "roof_report_versions_roof_report_id_fk" FOREIGN KEY ("org_id","roof_report_id") REFERENCES "public"."roof_reports"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_report_versions" ADD CONSTRAINT "roof_report_versions_imagery_asset_id_fk" FOREIGN KEY ("org_id","imagery_asset_id") REFERENCES "public"."imagery_assets"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_report_versions" ADD CONSTRAINT "roof_report_versions_supersedes_version_id_fk" FOREIGN KEY ("org_id","supersedes_version_id") REFERENCES "public"."roof_report_versions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_reports" ADD CONSTRAINT "roof_reports_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_reports" ADD CONSTRAINT "roof_reports_roof_order_id_fk" FOREIGN KEY ("org_id","roof_order_id") REFERENCES "public"."roof_orders"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_reports" ADD CONSTRAINT "roof_reports_structure_id_fk" FOREIGN KEY ("org_id","structure_id") REFERENCES "public"."structures"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_vertices" ADD CONSTRAINT "roof_vertices_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_vertices" ADD CONSTRAINT "roof_vertices_report_version_id_fk" FOREIGN KEY ("org_id","report_version_id") REFERENCES "public"."roof_report_versions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_policies" ADD CONSTRAINT "waste_policies_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_curb_project_id_fk" FOREIGN KEY ("org_id","curb_project_id") REFERENCES "public"."curb_projects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_media_asset_id_fk" FOREIGN KEY ("org_id","media_asset_id") REFERENCES "public"."media_assets"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_supersedes_id_fk" FOREIGN KEY ("org_id","supersedes_id") REFERENCES "public"."calibrations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_measurements" ADD CONSTRAINT "curb_measurements_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_measurements" ADD CONSTRAINT "curb_measurements_curb_project_id_fk" FOREIGN KEY ("org_id","curb_project_id") REFERENCES "public"."curb_projects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_measurements" ADD CONSTRAINT "curb_measurements_segment_id_fk" FOREIGN KEY ("org_id","segment_id") REFERENCES "public"."curb_segments"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_measurements" ADD CONSTRAINT "curb_measurements_calibration_id_fk" FOREIGN KEY ("org_id","calibration_id") REFERENCES "public"."calibrations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_measurements" ADD CONSTRAINT "curb_measurements_media_asset_id_fk" FOREIGN KEY ("org_id","media_asset_id") REFERENCES "public"."media_assets"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_observations" ADD CONSTRAINT "curb_observations_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_observations" ADD CONSTRAINT "curb_observations_curb_project_id_fk" FOREIGN KEY ("org_id","curb_project_id") REFERENCES "public"."curb_projects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_projects" ADD CONSTRAINT "curb_projects_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_projects" ADD CONSTRAINT "curb_projects_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_projects" ADD CONSTRAINT "curb_projects_property_id_fk" FOREIGN KEY ("org_id","property_id") REFERENCES "public"."properties"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_projects" ADD CONSTRAINT "curb_projects_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_projects" ADD CONSTRAINT "curb_projects_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_projects" ADD CONSTRAINT "curb_projects_contact_id_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_projects" ADD CONSTRAINT "curb_projects_assigned_membership_id_fk" FOREIGN KEY ("org_id","assigned_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_segments" ADD CONSTRAINT "curb_segments_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_segments" ADD CONSTRAINT "curb_segments_curb_project_id_fk" FOREIGN KEY ("org_id","curb_project_id") REFERENCES "public"."curb_projects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_segments" ADD CONSTRAINT "curb_segments_media_asset_id_fk" FOREIGN KEY ("org_id","media_asset_id") REFERENCES "public"."media_assets"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curb_segments" ADD CONSTRAINT "curb_segments_calibration_id_fk" FOREIGN KEY ("org_id","calibration_id") REFERENCES "public"."calibrations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_requirements" ADD CONSTRAINT "permit_requirements_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_requirements" ADD CONSTRAINT "permit_requirements_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_requirements" ADD CONSTRAINT "permit_requirements_curb_project_id_fk" FOREIGN KEY ("org_id","curb_project_id") REFERENCES "public"."curb_projects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_curb_project_id_fk" FOREIGN KEY ("org_id","curb_project_id") REFERENCES "public"."curb_projects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_reviews" ADD CONSTRAINT "safety_reviews_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_reviews" ADD CONSTRAINT "safety_reviews_curb_project_id_fk" FOREIGN KEY ("org_id","curb_project_id") REFERENCES "public"."curb_projects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_reviews" ADD CONSTRAINT "safety_reviews_reviewer_membership_id_fk" FOREIGN KEY ("org_id","reviewer_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_revisions" ADD CONSTRAINT "price_book_revisions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_revisions" ADD CONSTRAINT "price_book_revisions_price_book_id_fk" FOREIGN KEY ("org_id","price_book_id") REFERENCES "public"."price_books"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_items" ADD CONSTRAINT "price_items_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_items" ADD CONSTRAINT "price_items_price_book_revision_id_fk" FOREIGN KEY ("org_id","price_book_revision_id") REFERENCES "public"."price_book_revisions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rates" ADD CONSTRAINT "production_rates_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rates" ADD CONSTRAINT "production_rates_price_book_revision_id_fk" FOREIGN KEY ("org_id","price_book_revision_id") REFERENCES "public"."price_book_revisions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ADD CONSTRAINT "estimate_revisions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ADD CONSTRAINT "estimate_revisions_estimate_id_fk" FOREIGN KEY ("org_id","estimate_id") REFERENCES "public"."estimates"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_revisions" ADD CONSTRAINT "estimate_revisions_price_book_revision_id_fk" FOREIGN KEY ("org_id","price_book_revision_id") REFERENCES "public"."price_book_revisions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_curb_project_id_fk" FOREIGN KEY ("org_id","curb_project_id") REFERENCES "public"."curb_projects"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_roof_order_id_fk" FOREIGN KEY ("org_id","roof_order_id") REFERENCES "public"."roof_orders"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_membership_id_fk" FOREIGN KEY ("org_id","approver_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_delegation_id_fk" FOREIGN KEY ("org_id","delegation_id") REFERENCES "public"."approval_delegations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_id_fk" FOREIGN KEY ("org_id","merged_into_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_property_id_fk" FOREIGN KEY ("org_id","property_id") REFERENCES "public"."properties"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_membership_id_fk" FOREIGN KEY ("org_id","assigned_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_merged_into_id_fk" FOREIGN KEY ("org_id","merged_into_id") REFERENCES "public"."leads"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_membership_id_fk" FOREIGN KEY ("org_id","author_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_membership_id_fk" FOREIGN KEY ("org_id","assignee_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_id_fk" FOREIGN KEY ("org_id","crew_id") REFERENCES "public"."crews"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_membership_id_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_lead_membership_id_fk" FOREIGN KEY ("org_id","lead_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_schedule_id_fk" FOREIGN KEY ("org_id","schedule_id") REFERENCES "public"."schedules"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_crew_id_fk" FOREIGN KEY ("org_id","crew_id") REFERENCES "public"."crews"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stage_definitions" ADD CONSTRAINT "job_stage_definitions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_contact_id_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_property_id_fk" FOREIGN KEY ("org_id","property_id") REFERENCES "public"."properties"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lead_id_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."leads"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_membership_id_fk" FOREIGN KEY ("org_id","owner_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_crew_id_fk" FOREIGN KEY ("org_id","crew_id") REFERENCES "public"."crews"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_options" ADD CONSTRAINT "proposal_options_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_options" ADD CONSTRAINT "proposal_options_proposal_version_id_fk" FOREIGN KEY ("org_id","proposal_version_id") REFERENCES "public"."proposal_versions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_options" ADD CONSTRAINT "proposal_options_estimate_revision_id_fk" FOREIGN KEY ("org_id","estimate_revision_id") REFERENCES "public"."estimate_revisions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_selections" ADD CONSTRAINT "proposal_selections_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_selections" ADD CONSTRAINT "proposal_selections_proposal_version_id_fk" FOREIGN KEY ("org_id","proposal_version_id") REFERENCES "public"."proposal_versions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_selections" ADD CONSTRAINT "proposal_selections_package_option_id_fk" FOREIGN KEY ("org_id","package_option_id") REFERENCES "public"."proposal_options"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_selections" ADD CONSTRAINT "proposal_selections_selected_by_contact_id_fk" FOREIGN KEY ("org_id","selected_by_contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposal_id_fk" FOREIGN KEY ("org_id","proposal_id") REFERENCES "public"."proposals"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_contact_id_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposal_id_fk" FOREIGN KEY ("org_id","proposal_id") REFERENCES "public"."proposals"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposal_version_id_fk" FOREIGN KEY ("org_id","proposal_version_id") REFERENCES "public"."proposal_versions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_envelope_id_fk" FOREIGN KEY ("org_id","envelope_id") REFERENCES "public"."signature_envelopes"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelopes_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelopes_proposal_version_id_fk" FOREIGN KEY ("org_id","proposal_version_id") REFERENCES "public"."proposal_versions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_envelope_id_fk" FOREIGN KEY ("org_id","envelope_id") REFERENCES "public"."signature_envelopes"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_id_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_proposal_id_fk" FOREIGN KEY ("org_id","proposal_id") REFERENCES "public"."proposals"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_fk" FOREIGN KEY ("org_id","contract_id") REFERENCES "public"."contracts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_fk" FOREIGN KEY ("org_id","payment_id") REFERENCES "public"."payments"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fk" FOREIGN KEY ("org_id","payment_id") REFERENCES "public"."payments"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_job_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_contract_id_fk" FOREIGN KEY ("org_id","contract_id") REFERENCES "public"."contracts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_estimate_revision_id_fk" FOREIGN KEY ("org_id","estimate_revision_id") REFERENCES "public"."estimate_revisions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_envelope_id_fk" FOREIGN KEY ("org_id","envelope_id") REFERENCES "public"."signature_envelopes"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_contact_id_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_contact_id_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_membership_id_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_membership_id_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_membership_id_fk" FOREIGN KEY ("org_id","recipient_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_contact_id_fk" FOREIGN KEY ("org_id","recipient_contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_subscription_id_fk" FOREIGN KEY ("org_id","subscription_id") REFERENCES "public"."subscriptions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_reservation_id_fk" FOREIGN KEY ("org_id","reservation_id") REFERENCES "public"."usage_ledger"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_records" ADD CONSTRAINT "export_records_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_claimed_by_membership_id_fk" FOREIGN KEY ("org_id","claimed_by_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_first_reviewer_membership_id_fk" FOREIGN KEY ("org_id","first_reviewer_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_second_reviewer_membership_id_fk" FOREIGN KEY ("org_id","second_reviewer_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_results" ADD CONSTRAINT "inference_results_model_id_model_registry_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_results" ADD CONSTRAINT "inference_results_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_issuer_subject_uq" ON "external_identities" USING btree ("issuer","subject");--> statement-breakpoint
CREATE INDEX "external_identities_user_id_idx" ON "external_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "org_settings_revisions_org_id_idx" ON "org_settings_revisions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_settings_revisions_org_id_revision_number_uq" ON "org_settings_revisions" USING btree ("org_id","revision_number");--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_areas_org_id_idx" ON "service_areas" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_areas_org_id_name_uq" ON "service_areas" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "service_areas_boundary_gist" ON "service_areas" USING gist ("boundary");--> statement-breakpoint
CREATE INDEX "approval_delegations_org_id_idx" ON "approval_delegations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "approval_delegations_to_membership_id_idx" ON "approval_delegations" USING btree ("to_membership_id");--> statement-breakpoint
CREATE INDEX "invitations_org_id_idx" ON "invitations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_org_id_status_idx" ON "invitations" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "memberships_org_id_idx" ON "memberships" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_id_user_id_uq" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_org_id_idx" ON "permission_overrides" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_overrides_membership_id_action_uq" ON "permission_overrides" USING btree ("membership_id","action");--> statement-breakpoint
CREATE INDEX "role_bundles_org_id_idx" ON "role_bundles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_bundles_org_id_name_uq" ON "role_bundles" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_scope_key_uq" ON "feature_flags" USING btree (coalesce("org_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("jurisdiction_id", '00000000-0000-0000-0000-000000000000'::uuid),"key");--> statement-breakpoint
CREATE INDEX "feature_flags_org_id_idx" ON "feature_flags" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_id_idx" ON "audit_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_id_resource_type_resource_id_idx" ON "audit_events" USING btree ("org_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("org_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "domain_events_org_id_idx" ON "domain_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "domain_events_status_available_at_idx" ON "domain_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "domain_events_org_id_aggregate_type_aggregate_id_idx" ON "domain_events" USING btree ("org_id","aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_org_id_idx" ON "idempotency_keys" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_org_id_key_uq" ON "idempotency_keys" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "media_assets_org_id_idx" ON "media_assets" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_org_id_sha256_uq" ON "media_assets" USING btree ("org_id","sha256");--> statement-breakpoint
CREATE INDEX "media_assets_org_id_owner_type_owner_id_idx" ON "media_assets" USING btree ("org_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "media_redactions_org_id_idx" ON "media_redactions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "media_redactions_media_asset_id_idx" ON "media_redactions" USING btree ("media_asset_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_org_id_idx" ON "upload_sessions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_sessions_org_id_object_key_uq" ON "upload_sessions" USING btree ("org_id","object_key");--> statement-breakpoint
CREATE INDEX "attachments_org_id_idx" ON "attachments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "attachments_org_id_subject_type_subject_id_idx" ON "attachments" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "imagery_assets_org_id_idx" ON "imagery_assets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "imagery_assets_property_id_status_idx" ON "imagery_assets" USING btree ("property_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "imagery_assets_org_id_provider_provider_image_id_uq" ON "imagery_assets" USING btree ("org_id","provider","provider_image_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jurisdictions_code_uq" ON "jurisdictions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "jurisdictions_boundary_gist" ON "jurisdictions" USING gist ("boundary");--> statement-breakpoint
CREATE INDEX "properties_org_id_idx" ON "properties" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "properties_org_id_normalized_address_idx" ON "properties" USING btree ("org_id","normalized_address");--> statement-breakpoint
CREATE INDEX "properties_location_gist" ON "properties" USING gist ("location");--> statement-breakpoint
CREATE INDEX "properties_confirmed_location_gist" ON "properties" USING gist ("confirmed_location");--> statement-breakpoint
CREATE INDEX "structures_org_id_idx" ON "structures" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "structures_property_id_label_uq" ON "structures" USING btree ("property_id","label");--> statement-breakpoint
CREATE INDEX "structures_footprint_gist" ON "structures" USING gist ("footprint");--> statement-breakpoint
CREATE INDEX "material_catalog_items_org_id_idx" ON "material_catalog_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_catalog_items_org_id_sku_uq" ON "material_catalog_items" USING btree ("org_id","sku");--> statement-breakpoint
CREATE INDEX "material_takeoffs_org_id_idx" ON "material_takeoffs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "material_takeoffs_report_version_id_idx" ON "material_takeoffs" USING btree ("report_version_id");--> statement-breakpoint
CREATE INDEX "measurement_overrides_org_id_idx" ON "measurement_overrides" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "measurement_overrides_org_id_subject_type_subject_id_idx" ON "measurement_overrides" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "roof_edges_org_id_idx" ON "roof_edges" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roof_edges_report_version_id_key_uq" ON "roof_edges" USING btree ("report_version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "roof_edges_report_version_id_from_vertex_key_to_vertex_key_uq" ON "roof_edges" USING btree ("report_version_id","from_vertex_key","to_vertex_key");--> statement-breakpoint
CREATE INDEX "roof_facets_org_id_idx" ON "roof_facets" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roof_facets_report_version_id_key_uq" ON "roof_facets" USING btree ("report_version_id","key");--> statement-breakpoint
CREATE INDEX "roof_geometry_ops_org_id_idx" ON "roof_geometry_ops" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roof_geometry_ops_report_version_id_sequence_uq" ON "roof_geometry_ops" USING btree ("report_version_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "roof_geometry_ops_report_version_id_client_op_id_uq" ON "roof_geometry_ops" USING btree ("report_version_id","client_op_id");--> statement-breakpoint
CREATE INDEX "roof_order_events_org_id_idx" ON "roof_order_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "roof_order_events_roof_order_id_occurred_at_idx" ON "roof_order_events" USING btree ("roof_order_id","occurred_at");--> statement-breakpoint
CREATE INDEX "roof_orders_org_id_idx" ON "roof_orders" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roof_orders_org_id_number_uq" ON "roof_orders" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "roof_orders_org_id_status_idx" ON "roof_orders" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "roof_report_versions_org_id_idx" ON "roof_report_versions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roof_report_versions_roof_report_id_version_number_uq" ON "roof_report_versions" USING btree ("roof_report_id","version_number");--> statement-breakpoint
CREATE INDEX "roof_reports_org_id_idx" ON "roof_reports" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "roof_reports_roof_order_id_idx" ON "roof_reports" USING btree ("roof_order_id");--> statement-breakpoint
CREATE INDEX "roof_vertices_org_id_idx" ON "roof_vertices" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roof_vertices_report_version_id_key_uq" ON "roof_vertices" USING btree ("report_version_id","key");--> statement-breakpoint
CREATE INDEX "waste_policies_org_id_idx" ON "waste_policies" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waste_policies_org_id_name_uq" ON "waste_policies" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "calibrations_org_id_idx" ON "calibrations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "curb_measurements_org_id_idx" ON "curb_measurements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "curb_measurements_curb_project_id_kind_idx" ON "curb_measurements" USING btree ("curb_project_id","kind");--> statement-breakpoint
CREATE INDEX "curb_observations_org_id_idx" ON "curb_observations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "curb_observations_curb_project_id_question_key_uq" ON "curb_observations" USING btree ("curb_project_id","question_key");--> statement-breakpoint
CREATE INDEX "curb_projects_org_id_idx" ON "curb_projects" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "curb_projects_org_id_number_uq" ON "curb_projects" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "curb_projects_org_id_status_idx" ON "curb_projects" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "curb_segments_org_id_idx" ON "curb_segments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "permit_requirements_org_id_idx" ON "permit_requirements" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permit_requirements_curb_project_id_permit_type_uq" ON "permit_requirements" USING btree ("curb_project_id","permit_type");--> statement-breakpoint
CREATE INDEX "risk_flags_org_id_idx" ON "risk_flags" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "risk_flags_curb_project_id_status_idx" ON "risk_flags" USING btree ("curb_project_id","status");--> statement-breakpoint
CREATE INDEX "safety_reviews_org_id_idx" ON "safety_reviews" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_reviews_curb_project_id_kind_uq" ON "safety_reviews" USING btree ("curb_project_id","kind");--> statement-breakpoint
CREATE INDEX "price_book_revisions_org_id_idx" ON "price_book_revisions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_book_revisions_price_book_id_revision_number_uq" ON "price_book_revisions" USING btree ("price_book_id","revision_number");--> statement-breakpoint
CREATE INDEX "price_books_org_id_idx" ON "price_books" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_books_org_id_name_uq" ON "price_books" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "price_items_org_id_idx" ON "price_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_items_price_book_revision_id_code_uq" ON "price_items" USING btree ("price_book_revision_id","code");--> statement-breakpoint
CREATE INDEX "production_rates_org_id_idx" ON "production_rates" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_rates_price_book_revision_id_code_uq" ON "production_rates" USING btree ("price_book_revision_id","code");--> statement-breakpoint
CREATE INDEX "estimate_revisions_org_id_idx" ON "estimate_revisions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "estimate_revisions_estimate_id_revision_number_uq" ON "estimate_revisions" USING btree ("estimate_id","revision_number");--> statement-breakpoint
CREATE INDEX "estimates_org_id_idx" ON "estimates" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "estimates_org_id_number_uq" ON "estimates" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "approvals_org_id_idx" ON "approvals" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "approvals_org_id_subject_type_subject_id_idx" ON "approvals" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "contacts_org_id_idx" ON "contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contacts_customer_id_idx" ON "contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("org_id",lower("email"));--> statement-breakpoint
CREATE INDEX "customers_org_id_idx" ON "customers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "customers_display_name_idx" ON "customers" USING btree ("org_id",lower("display_name"));--> statement-breakpoint
CREATE INDEX "leads_org_id_idx" ON "leads" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "leads_org_id_status_idx" ON "leads" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "leads_org_id_dedupe_key_idx" ON "leads" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notes_org_id_idx" ON "notes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "notes_org_id_subject_type_subject_id_idx" ON "notes" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "tasks_org_id_idx" ON "tasks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tasks_org_id_subject_type_subject_id_idx" ON "tasks" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_membership_id_status_idx" ON "tasks" USING btree ("assignee_membership_id","status");--> statement-breakpoint
CREATE INDEX "crew_members_org_id_idx" ON "crew_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "crew_members_crew_id_idx" ON "crew_members" USING btree ("crew_id");--> statement-breakpoint
CREATE INDEX "crews_org_id_idx" ON "crews" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crews_org_id_name_uq" ON "crews" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "dispatches_org_id_idx" ON "dispatches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "dispatches_org_id_status_idx" ON "dispatches" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "job_events_org_id_idx" ON "job_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "job_events_job_id_occurred_at_idx" ON "job_events" USING btree ("job_id","occurred_at");--> statement-breakpoint
CREATE INDEX "job_stage_definitions_org_id_idx" ON "job_stage_definitions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_stage_definitions_org_id_key_uq" ON "job_stage_definitions" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "jobs_org_id_idx" ON "jobs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_org_id_number_uq" ON "jobs" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "jobs_org_id_stage_key_idx" ON "jobs" USING btree ("org_id","stage_key");--> statement-breakpoint
CREATE INDEX "schedules_org_id_idx" ON "schedules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "schedules_crew_id_starts_at_idx" ON "schedules" USING btree ("crew_id","starts_at");--> statement-breakpoint
CREATE INDEX "supplier_orders_org_id_idx" ON "supplier_orders" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "supplier_orders_org_id_status_idx" ON "supplier_orders" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "proposal_options_org_id_idx" ON "proposal_options" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_options_proposal_version_id_key_uq" ON "proposal_options" USING btree ("proposal_version_id","key");--> statement-breakpoint
CREATE INDEX "proposal_selections_org_id_idx" ON "proposal_selections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_selections_proposal_version_id_uq" ON "proposal_selections" USING btree ("proposal_version_id");--> statement-breakpoint
CREATE INDEX "proposal_versions_org_id_idx" ON "proposal_versions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_versions_proposal_id_version_number_uq" ON "proposal_versions" USING btree ("proposal_id","version_number");--> statement-breakpoint
CREATE INDEX "proposals_org_id_idx" ON "proposals" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_org_id_number_uq" ON "proposals" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "proposals_org_id_status_idx" ON "proposals" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "contracts_org_id_idx" ON "contracts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_org_id_number_uq" ON "contracts" USING btree ("org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_proposal_version_id_uq" ON "contracts" USING btree ("proposal_version_id");--> statement-breakpoint
CREATE INDEX "signature_envelopes_org_id_idx" ON "signature_envelopes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "signature_envelopes_org_id_subject_type_subject_id_idx" ON "signature_envelopes" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "signature_events_org_id_idx" ON "signature_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "signature_events_envelope_id_occurred_at_idx" ON "signature_events" USING btree ("envelope_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_events_org_id_provider_event_id_uq" ON "signature_events" USING btree ("org_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_org_id_idx" ON "invoice_lines" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_org_id_idx" ON "invoices" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_id_number_uq" ON "invoices" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "invoices_org_id_status_idx" ON "invoices" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "ledger_entries_org_id_idx" ON "ledger_entries" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_org_id_transaction_id_idx" ON "ledger_entries" USING btree ("org_id","transaction_id");--> statement-breakpoint
CREATE INDEX "payment_events_org_id_idx" ON "payment_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_provider_event_id_uq" ON "payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payments_org_id_idx" ON "payments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_id_provider_provider_payment_id_uq" ON "payments" USING btree ("org_id","provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_id_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "change_orders_org_id_idx" ON "change_orders" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "change_orders_org_id_number_uq" ON "change_orders" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "portal_tokens_org_id_idx" ON "portal_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_token_hash_uq" ON "portal_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_tokens_org_id_scope_subject_id_idx" ON "portal_tokens" USING btree ("org_id","scope","subject_id");--> statement-breakpoint
CREATE INDEX "consents_org_id_idx" ON "consents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "consents_contact_id_kind_idx" ON "consents" USING btree ("contact_id","kind");--> statement-breakpoint
CREATE INDEX "notification_preferences_org_id_idx" ON "notification_preferences" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_membership_id_category_channel_uq" ON "notification_preferences" USING btree ("membership_id","category","channel");--> statement-breakpoint
CREATE INDEX "notifications_org_id_idx" ON "notifications" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_membership_id_read_at_idx" ON "notifications" USING btree ("recipient_membership_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_org_id_dedupe_key_uq" ON "notifications" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "entitlements_org_id_idx" ON "entitlements" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_org_id_key_source_uq" ON "entitlements" USING btree ("org_id","key","source");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_uq" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_idx" ON "subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_status_idx" ON "subscriptions" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "usage_ledger_org_id_idx" ON "usage_ledger" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_org_id_meter_idx" ON "usage_ledger" USING btree ("org_id","meter");--> statement-breakpoint
CREATE INDEX "usage_ledger_reservation_id_idx" ON "usage_ledger" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_org_id_idempotency_key_uq" ON "usage_ledger" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "export_records_org_id_idx" ON "export_records" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "export_records_org_id_subject_type_subject_id_idx" ON "export_records" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "review_tasks_org_id_idx" ON "review_tasks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "review_tasks_org_id_status_kind_idx" ON "review_tasks" USING btree ("org_id","status","kind");--> statement-breakpoint
CREATE INDEX "review_tasks_org_id_subject_type_subject_id_idx" ON "review_tasks" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "inference_results_org_id_idx" ON "inference_results" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "inference_results_org_id_subject_type_subject_id_idx" ON "inference_results" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_registry_name_version_uq" ON "model_registry" USING btree ("name","version");--> statement-breakpoint
CREATE INDEX "model_registry_task_stage_idx" ON "model_registry" USING btree ("task","stage");