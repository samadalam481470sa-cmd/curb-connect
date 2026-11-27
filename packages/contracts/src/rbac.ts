// PLT-015 / BE-078 RBAC policy file: roles x actions. The API evaluates can() on every request
// (server-side authority, PLT-011 R); the web app uses the same matrix only to hide buttons and
// explain missing power. Homeowners are portal principals, never members (STR-004 R).
import { z } from 'zod';
import { MEMBER_ROLES, type MemberRole, type PortalTokenScope } from './enums';

const ALL: readonly MemberRole[] = MEMBER_ROLES;
const MANAGERS: readonly MemberRole[] = ['owner', 'admin'];
/** Everyone except read_only. */
const STAFF: readonly MemberRole[] = MEMBER_ROLES.filter((r) => r !== 'read_only');

/**
 * The policy matrix: each action lists the roles allowed to perform it. Keep this the single
 * source of truth. Adding an action here is a product decision: update docs/product's permission
 * matrix and the matrix tests together.
 */
export const POLICY = {
  // organization and settings
  'org:read': ALL,
  'org:update': MANAGERS,
  'org:settings_update': MANAGERS,
  'org:transfer_ownership': ['owner'],
  'org:close': ['owner'],
  'billing_settings:read': ['owner', 'admin', 'finance'],
  /** "Company payment settings" (PLT-015 G: estimators must not edit them). */
  'billing_settings:update': ['owner', 'admin', 'finance'],
  'subscription:manage': ['owner', 'admin', 'finance'],
  'usage:read': ['owner', 'admin', 'finance'],
  'integration:manage': MANAGERS,
  'flags:read': ALL,
  'flags:manage': MANAGERS,
  'audit:read': ['owner', 'admin', 'finance'],

  // team
  'team:read': ALL,
  'team:invite': MANAGERS,
  'team:update_role': MANAGERS,
  'team:revoke': MANAGERS,
  'team:manage_delegations': MANAGERS,
  'role_bundles:manage': ['owner'],

  // dashboard, search, analytics
  'dashboard:read': ALL,
  'search:read': ALL,
  'analytics:read': [
    'owner',
    'admin',
    'estimator',
    'reviewer',
    'salesperson',
    'finance',
    'read_only',
  ],

  // properties and imagery
  'property:read': ALL,
  'property:write': ['owner', 'admin', 'estimator', 'salesperson'],
  'imagery:read': ALL,
  /** Spends imagery credits. */
  'imagery:order': ['owner', 'admin', 'estimator'],

  // roof
  'roof_order:read': ALL,
  'roof_order:create': ['owner', 'admin', 'estimator', 'salesperson'],
  'roof_order:transition': ['owner', 'admin', 'estimator', 'reviewer'],
  'roof_order:cancel': ['owner', 'admin', 'estimator'],
  'roof_report:read': ALL,
  'roof_report:edit_geometry': ['owner', 'admin', 'estimator', 'reviewer'],
  'roof_report:submit': ['owner', 'admin', 'estimator'],
  'roof_report:approve': ['owner', 'admin', 'reviewer'],
  'roof_report:issue': ['owner', 'admin', 'reviewer'],
  'measurement:override': ['owner', 'admin', 'estimator', 'reviewer'],
  'roof_takeoff:write': ['owner', 'admin', 'estimator'],
  'export:create': ['owner', 'admin', 'estimator', 'reviewer', 'salesperson'],

  // curb
  'curb_project:read': ALL,
  'curb_project:write': ['owner', 'admin', 'estimator', 'salesperson'],
  'curb_media:upload': ['owner', 'admin', 'estimator', 'salesperson', 'crew_manager'],
  'curb_calibration:write': ['owner', 'admin', 'estimator', 'reviewer'],
  'curb_measurement:write': ['owner', 'admin', 'estimator', 'reviewer'],
  /** Marks a dimension field_verified; requires a documented site check. */
  'curb_measurement:verify': ['owner', 'admin', 'reviewer', 'crew_manager'],
  'risk_flag:write': ['owner', 'admin', 'estimator', 'reviewer'],
  'risk_flag:resolve': ['owner', 'admin', 'reviewer'],
  'permit:read': ALL,
  'permit:manage': ['owner', 'admin', 'estimator', 'reviewer'],
  'safety_review:sign': ['owner', 'admin', 'reviewer', 'crew_manager'],
  'jurisdiction:read': ALL,

  // estimates, pricing, approvals
  'estimate:read': ALL,
  'estimate:write': ['owner', 'admin', 'estimator'],
  /** Gated: the API also requires zero gating blockers (CP-059). */
  'estimate:approve': ['owner', 'admin', 'reviewer'],
  'takeoff:approve_calibration': ['owner', 'admin'],
  /** Internal costs, margins and profit projection (OPS-065 A, OPS-070 A). */
  'estimate:view_cost': ['owner', 'admin', 'estimator', 'reviewer', 'finance'],
  'price_book:read': ['owner', 'admin', 'estimator', 'reviewer', 'finance'],
  'price_book:write': ['owner', 'admin', 'finance'],
  'price_book:approve': ['owner', 'admin', 'finance'],
  'approval:read': ALL,
  'approval:withdraw': ['owner', 'admin', 'reviewer', 'finance'],
  'review_task:read': ['owner', 'admin', 'estimator', 'reviewer'],
  'review_task:claim': ['owner', 'admin', 'reviewer'],
  'review_task:decide': ['owner', 'admin', 'reviewer'],
  'review_task:assign': MANAGERS,

  // CRM and jobs
  'customer:read': ALL,
  'customer:write': ['owner', 'admin', 'estimator', 'salesperson'],
  'customer:merge': ['owner', 'admin', 'salesperson'],
  'lead:read': ALL,
  'lead:write': ['owner', 'admin', 'estimator', 'salesperson'],
  'lead:convert': ['owner', 'admin', 'estimator', 'salesperson'],
  'job:read': ALL,
  'job:write': ['owner', 'admin', 'estimator', 'salesperson', 'crew_manager'],
  'job:move_stage': ['owner', 'admin', 'estimator', 'salesperson', 'crew_manager'],
  'enterprise_media:read': ['owner', 'admin', 'crew_manager', 'reviewer'],
  'enterprise_media:upload': ['owner', 'admin', 'crew_manager'],
  'enterprise_media:annotate': ['owner', 'admin', 'reviewer'],
  'enterprise_media:decide_evidence': ['owner', 'reviewer'],
  'enterprise_media:approve_customer_media': MANAGERS,
  'enterprise_media:share_customer_media': MANAGERS,
  'enterprise_media:manage_grants': MANAGERS,
  'enterprise_budget:read': ['owner', 'admin', 'estimator', 'finance'],
  'enterprise_budget:edit_draft': ['owner', 'admin', 'estimator'],
  'enterprise_budget:approve': MANAGERS,
  'enterprise_budget:run_scenario': ['owner', 'finance'],
  'enterprise_budget:request_overrun': ['admin'],
  'enterprise_budget:approve_overrun': ['owner'],
  'enterprise_budget:manage_grants': MANAGERS,
  'pipeline:configure': MANAGERS,
  'task:write': STAFF,
  'note:write': STAFF,

  // proposals, signatures, contracts
  'proposal:read': ALL,
  'proposal:write': ['owner', 'admin', 'estimator', 'salesperson'],
  /** Needed when a discount drops below the margin floor (OPS-065 D). */
  'proposal:approve': ['owner', 'admin', 'finance'],
  'proposal:send': ['owner', 'admin', 'salesperson'],
  'proposal:void': ['owner', 'admin', 'salesperson'],
  'signature:send': ['owner', 'admin', 'salesperson'],
  'signature:void': MANAGERS,
  'contract:read': [
    'owner',
    'admin',
    'estimator',
    'salesperson',
    'crew_manager',
    'finance',
    'read_only',
  ],
  'portal_link:create': ['owner', 'admin', 'salesperson', 'finance'],
  'portal_link:revoke': ['owner', 'admin', 'salesperson', 'finance'],

  // billing
  'invoice:read': ['owner', 'admin', 'salesperson', 'finance', 'read_only'],
  'invoice:write': ['owner', 'admin', 'finance'],
  'invoice:issue': ['owner', 'admin', 'finance'],
  'invoice:void': ['owner', 'admin', 'finance'],
  'payment:read': ['owner', 'admin', 'finance'],
  'payment:record': ['owner', 'admin', 'finance'],
  'payment:refund': ['owner', 'finance'],
  'change_order:read': ALL,

  // contractor network (workstreams 06-09): connecting grants only workflow-scoped access.
  'network:read': ALL,
  'network:connect': ['owner', 'admin', 'salesperson', 'finance'],
  'network:manage': MANAGERS,
  'network:listing_update': MANAGERS,
  /** Bills are the recipient's payable records: financial data stays with finance roles. */
  'bill:read': ['owner', 'admin', 'finance', 'read_only', 'reviewer'],
  'bill:approve': ['owner', 'admin', 'finance'],
  'bill:dispute': ['owner', 'admin', 'finance', 'reviewer'],
  'bill:pay': ['owner', 'admin', 'finance'],
  'payment_link:create': ['owner', 'admin', 'finance'],
  'ledger:read': ['owner', 'admin', 'finance', 'read_only'],
  'change_order:write': ['owner', 'admin', 'estimator', 'salesperson'],
  'change_order:approve': ['owner', 'admin', 'finance'],

  // plumbing (ConstructionOS module 10): the estimator is a planning tool; approved design and
  // code-compliance decisions stay with the estimator/reviewer roles, never the tool.
  'plumbing:read': ALL,
  'plumbing:write': ['owner', 'admin', 'estimator', 'crew_manager'],
  'plumbing:estimate': ['owner', 'admin', 'estimator', 'salesperson'],
  'plumbing:approve': ['owner', 'admin', 'reviewer'],

  // field operations
  'land_scout:read': ALL,
  'land_scout:write': ['owner', 'admin', 'estimator', 'salesperson'],
  'land_feasibility:read': ALL,
  'land_feasibility:write': ['owner', 'admin', 'estimator', 'salesperson'],
  'supplier_order:read': ['owner', 'admin', 'estimator', 'crew_manager', 'finance'],
  'supplier_order:write': ['owner', 'admin', 'crew_manager'],
  /** Actually sends an order to a supplier; requires explicit acknowledgment (OPS-066 B). */
  'supplier_order:submit': ['owner', 'admin', 'crew_manager'],
  'crew:read': ALL,
  'crew:manage': ['owner', 'admin', 'crew_manager'],
  'schedule:read': ALL,
  'schedule:write': ['owner', 'admin', 'crew_manager'],
  /** Gated by readiness: permits, utility locates, safety plan, signed contract (OPS-067). */
  'dispatch:release': ['owner', 'admin', 'crew_manager'],

  // builder operations (Hyphen-equivalent section: warranty/service, job cost, payables,
  // home sales + design center, supplier order flow, land management, attention feed,
  // field time + checklists, integrations). Financial writes stay with finance roles;
  // field writes stay with field roles.
  'warranty:read': ALL,
  'warranty:write': ['owner', 'admin', 'salesperson', 'crew_manager'],
  'job_cost:read': ['owner', 'admin', 'estimator', 'finance', 'read_only', 'reviewer'],
  'job_cost:write': ['owner', 'admin', 'estimator', 'finance'],
  'draw:read': ['owner', 'admin', 'estimator', 'finance', 'read_only', 'reviewer'],
  'draw:write': ['owner', 'admin', 'estimator', 'finance'],
  'draw:approve': ['owner', 'admin', 'finance'],
  'ap:read': ['owner', 'admin', 'finance', 'read_only', 'reviewer'],
  'ap:write': ['owner', 'admin', 'finance'],
  'ap:approve': ['owner', 'admin', 'finance'],
  // general ledger (blueprint gap 3): chart of accounts, journals, periods, statements.
  // The payment settlement ledger (ledger_entries) stays separate; the GL holds journals
  // posted here. No payer-side accounting treatment is invented.
  'gl:read': ['owner', 'admin', 'finance', 'read_only'],
  'gl:write': ['owner', 'admin', 'finance'],
  'gl:post': ['owner', 'admin', 'finance'],
  'gl:manage': ['owner', 'admin'],
  // concrete dispatch (blueprint gap 5): mix designs, orders, load tickets.
  'concrete:read': ALL,
  'concrete:write': ['owner', 'admin', 'crew_manager', 'finance'],
  // trade finder vendor records (blueprint gap 6): the org's own private vendors.
  'vendor:read': ALL,
  'vendor:write': ['owner', 'admin', 'salesperson', 'estimator', 'finance'],
  // purchase requisitions + backorders (blueprint gap 7).
  'requisition:read': ALL,
  'requisition:write': ['owner', 'admin', 'estimator', 'crew_manager', 'finance'],
  'requisition:approve': ['owner', 'admin', 'finance'],
  // portal capture (Renditions-style external-order gathering): connections
  // hold supplier portal credentials, so vault management stays owner/admin;
  // capture runs and PO-draft conversion follow the requisition writers.
  'portal_capture:read': ['owner', 'admin', 'estimator', 'finance', 'read_only'],
  'portal_capture:write': ['owner', 'admin', 'estimator', 'crew_manager', 'finance'],
  'portal_capture:manage': ['owner', 'admin'],
  'lien_release:read': ['owner', 'admin', 'finance', 'read_only', 'reviewer'],
  'lien_release:write': ['owner', 'admin', 'finance'],
  'sales:read': ALL,
  'sales:write': ['owner', 'admin', 'salesperson', 'estimator'],
  'enterprise_sales:intake': ['owner', 'admin', 'salesperson'],
  'enterprise_sales:manage': ['owner', 'admin'],
  'design_center:read': ALL,
  'design_center:write': ['owner', 'admin', 'salesperson', 'estimator'],
  'network_order:read': ['owner', 'admin', 'estimator', 'crew_manager', 'finance', 'read_only'],
  'network_order:write': ['owner', 'admin', 'estimator', 'crew_manager', 'finance'],
  'land_management:read': ALL,
  'land_management:write': ['owner', 'admin', 'estimator', 'salesperson', 'finance'],
  'attention:read': ALL,
  'time_entry:read': ALL,
  'time_entry:write': STAFF,
  'inspection_checklist:read': ALL,
  'inspection_checklist:write': ['owner', 'admin', 'crew_manager', 'reviewer'],
  /** Payouts move money once a provider is connected; gated until then. */
  'payout:read': ['owner', 'admin', 'finance'],
  'payout:manage': ['owner', 'admin', 'finance'],
  'assignment:read': ALL,
  'assignment:write': ['owner', 'admin', 'estimator', 'salesperson', 'crew_manager'],

  // personal
  'notification:read_own': ALL,
  'notification:update_preferences': ALL,
  /**
   * Connect or disconnect the member's own Gmail / Outlook mailbox that invoices are emailed from.
   * The mailbox belongs to the person, so it follows the roles that can issue invoices.
   */
  'mailbox:manage_own': ['owner', 'admin', 'finance'],
} as const satisfies Record<string, readonly MemberRole[]>;

export type Action = keyof typeof POLICY;
export const ACTIONS = Object.keys(POLICY) as Action[];
export const ActionSchema = z.enum(ACTIONS as [Action, ...Action[]]);

export function isAction(value: string): value is Action {
  return Object.hasOwn(POLICY, value);
}

/** Pure policy check: does `role` allow `action`? Unknown roles or actions are denied. */
export function can(role: MemberRole, action: Action): boolean {
  const allowed: readonly MemberRole[] | undefined = (
    POLICY as Record<string, readonly MemberRole[]>
  )[action];
  return allowed?.includes(role) ?? false;
}

/** Every action a role allows, in policy order. */
export function permissionsFor(role: MemberRole): Action[] {
  return ACTIONS.filter((action) => can(role, action));
}

export interface PermissionOverride {
  action: Action;
  effect: 'grant' | 'deny';
  /** ISO timestamp; an expired override is ignored. */
  expiresAt?: string | null;
}

/**
 * Role permissions adjusted by per-member overrides (role_permission_overrides). Deny wins over
 * grant. An owner can never be denied team or ownership actions, so an org cannot lock itself out.
 */
export function effectivePermissions(
  role: MemberRole,
  overrides: readonly PermissionOverride[] = [],
  now: Date = new Date(),
): Set<Action> {
  const result = new Set(permissionsFor(role));
  const active = overrides.filter((o) => !o.expiresAt || new Date(o.expiresAt) > now);
  for (const o of active) if (o.effect === 'grant') result.add(o.action);
  for (const o of active) {
    if (o.effect !== 'deny') continue;
    if (role === 'owner' && OWNER_PROTECTED_ACTIONS.includes(o.action)) continue;
    result.delete(o.action);
  }
  return result;
}

export function canWithOverrides(
  role: MemberRole,
  action: Action,
  overrides: readonly PermissionOverride[] = [],
  now: Date = new Date(),
): boolean {
  return effectivePermissions(role, overrides, now).has(action);
}

export const OWNER_PROTECTED_ACTIONS: readonly Action[] = [
  'team:read',
  'team:invite',
  'team:update_role',
  'team:revoke',
  'org:transfer_ownership',
  'role_bundles:manage',
];

/** Human-readable explanation for a denied action (PLT-015 A). */
export function explainDenied(role: MemberRole, action: Action): string {
  const allowed = (POLICY as Record<string, readonly MemberRole[]>)[action] ?? [];
  const names = allowed.map((r) => ROLE_LABELS[r]).join(', ');
  return `The ${ROLE_LABELS[role]} role cannot do this. Allowed roles: ${names || 'none'}.`;
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  estimator: 'Estimator',
  reviewer: 'Reviewer',
  salesperson: 'Salesperson',
  crew_manager: 'Crew manager',
  finance: 'Finance',
  read_only: 'Read-only',
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: 'Owner of record. Full control, including ownership transfer and closing the company.',
  admin: 'Manages team, settings, pricing and every workflow except ownership.',
  estimator: 'Measures roofs and curbs, prepares estimates and proposals. Cannot approve them.',
  reviewer: 'Verifies measurements, resolves risks and approves gated estimates and reports.',
  salesperson: 'Works leads, customers and proposals, sends documents for signature.',
  crew_manager: 'Schedules crews, manages supplier orders and releases ready work for dispatch.',
  finance: 'Invoices, payments, refunds, price books and billing settings.',
  read_only: 'Views records. Cannot change anything or see internal costs.',
};

// ---------------------------------------------------------------- homeowner portal principal
export const PORTAL_ACTIONS = [
  'portal:view',
  'portal:select_option',
  'portal:sign',
  'portal:pay',
  'portal:upload',
  'portal:message',
] as const;
export type PortalAction = (typeof PORTAL_ACTIONS)[number];

const PORTAL_POLICY: Record<PortalTokenScope, readonly PortalAction[]> = {
  proposal: ['portal:view', 'portal:select_option', 'portal:sign', 'portal:message'],
  invoice: ['portal:view', 'portal:pay', 'portal:message'],
  report: ['portal:view'],
  job: ['portal:view', 'portal:message'],
  upload_request: ['portal:view', 'portal:upload'],
};

/** OPS-070: a portal token is scoped to one resource and a fixed action set. */
export function portalCan(scope: PortalTokenScope, action: PortalAction): boolean {
  return PORTAL_POLICY[scope].includes(action);
}
