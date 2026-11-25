// Evidence-backed compliance for the 18 control gates in the Enterprise control-level addendum.
//
// The addendum lists the gates every feature area must satisfy. A list is not proof: each gate
// below names the requirement, the evidence an auditor should expect, and how long that evidence
// stays valid. Organizations assign an owner and expiry to each gate, attach reviewed evidence, and
// export a checksummed audit packet that states what was proven on the export date.

export const CONTROL_COMPLIANCE_WARNING_DAYS = 30;
export const CONTROL_AUDIT_PACKET_VERSION = '1.0';
export const CONTROL_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;

export const CONTROL_EVIDENCE_REVIEW_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type ControlEvidenceReviewStatus = (typeof CONTROL_EVIDENCE_REVIEW_STATUSES)[number];

export const CONTROL_COMPLIANCE_STATUSES = [
  'missing',
  'in_progress',
  'pending_review',
  'satisfied',
  'expiring',
  'expired',
] as const;
export type ControlComplianceStatus = (typeof CONTROL_COMPLIANCE_STATUSES)[number];

export interface ControlGateDefinition {
  readonly key: string;
  readonly order: number;
  readonly title: string;
  /** What the suite must demonstrate for this gate. */
  readonly requirement: string;
  /** The artefact or test result that proves the requirement. */
  readonly evidenceStandard: string;
  /** How long accepted evidence remains valid before it must be refreshed. */
  readonly validityDays: number;
}

export const CONTROL_GATE_DEFINITIONS: readonly ControlGateDefinition[] = [
  {
    key: 'product-contract',
    order: 1,
    title: 'Product contract and business rules',
    requirement:
      'Document the product scope, operating rules, approvals and exceptions this feature area enforces.',
    evidenceStandard:
      'Approved product contract or rule register with its version, effective date and sign-off.',
    validityDays: 365,
  },
  {
    key: 'roles-permissions',
    order: 2,
    title: 'Roles, permissions and data visibility',
    requirement:
      'Prove that each role can perform only its documented actions and can see only its permitted records and fields.',
    evidenceStandard:
      'Permission matrix plus server-side role and field-visibility test results for allowed and denied access.',
    validityDays: 365,
  },
  {
    key: 'routes-screens',
    order: 3,
    title: 'Routes, navigation and screen inventory',
    requirement:
      'Every documented route and screen is reachable by an allowed role, shows the specified content and is unavailable to other roles.',
    evidenceStandard:
      'Route and screen inventory with access-check results, including an unauthorized-role denial.',
    validityDays: 365,
  },
  {
    key: 'dashboard-queues',
    order: 4,
    title: 'Dashboard and work queues',
    requirement:
      'Dashboard metrics and work queues reconcile to their source records and show the documented empty, loading and error states.',
    evidenceStandard:
      'Metric definition, a reconciliation to source totals and a review of the queue filters and states.',
    validityDays: 365,
  },
  {
    key: 'list-controls',
    order: 5,
    title: 'List view, toolbar and table controls',
    requirement:
      'Lists support the specified filters, sorting, pagination, columns and bulk actions without crossing tenant or permission boundaries.',
    evidenceStandard:
      'List acceptance record covering filters, sorting, pagination and each bulk action, with tenant-boundary results.',
    validityDays: 365,
  },
  {
    key: 'record-detail',
    order: 6,
    title: 'Record detail page and tabs',
    requirement:
      'The record detail page shows authoritative data, related records and history for the selected record.',
    evidenceStandard:
      'Detail-page acceptance record with one linked related record and its audit history.',
    validityDays: 365,
  },
  {
    key: 'create-edit',
    order: 7,
    title: 'Create and edit workflow',
    requirement:
      'Create and edit flows validate input, enforce required fields and reject invalid, cross-tenant or stale writes.',
    evidenceStandard:
      'Workflow test results for success, validation failure and optimistic-concurrency conflict.',
    validityDays: 365,
  },
  {
    key: 'action-contract',
    order: 8,
    title: 'Button-by-button interaction contract',
    requirement:
      'Every specified action is present, permission-gated and has a tested success, cancel and failure path.',
    evidenceStandard:
      'Action inventory with a pass or fail result and an audit reference for every specified button.',
    validityDays: 365,
  },
  {
    key: 'preferences',
    order: 9,
    title: 'Toggle, checkbox and preference contract',
    requirement:
      'Toggles and preferences persist in the documented scope and never change another user or tenant setting.',
    evidenceStandard:
      'Preference persistence evidence plus a second user or tenant showing an unchanged setting.',
    validityDays: 365,
  },
  {
    key: 'lifecycle',
    order: 10,
    title: 'Lifecycle and decision logic',
    requirement:
      'Statuses, allowed transitions, approvals and closeout rules match the documented lifecycle.',
    evidenceStandard:
      'Lifecycle transition matrix with valid transitions and rejected invalid transitions.',
    validityDays: 365,
  },
  {
    key: 'data-integrity',
    order: 11,
    title: 'Database and data integrity',
    requirement:
      "Tables, keys, constraints, tenant isolation and immutable history protect this feature area's records.",
    evidenceStandard:
      'Schema review, constraint tests and row-level security verification with two tenants.',
    validityDays: 365,
  },
  {
    key: 'api-contract',
    order: 12,
    title: 'API and request/response contracts',
    requirement:
      'Every route validates input, returns the documented response and fails with a stable problem contract.',
    evidenceStandard:
      'Contract test results for a successful request, a validation failure and an authorization failure.',
    validityDays: 365,
  },
  {
    key: 'events-workers',
    order: 13,
    title: 'Events, workers and notifications',
    requirement:
      'Events are written once, retries are idempotent and notifications reach the intended recipient.',
    evidenceStandard:
      'Event or outbox replay evidence plus notification delivery and duplicate-suppression results.',
    validityDays: 365,
  },
  {
    key: 'integrations',
    order: 14,
    title: 'Integration and reconciliation behavior',
    requirement:
      'External synchronization prevents duplicate posting, surfaces conflicts and reconciles differences.',
    evidenceStandard:
      'Integration run log with duplicate-prevention, conflict and reconciliation outcomes.',
    validityDays: 365,
  },
  {
    key: 'security-audit',
    order: 15,
    title: 'Security, privacy and audit',
    requirement:
      'Authentication, authorization, tenant isolation and audit logging are verified for this feature area.',
    evidenceStandard:
      'Security test results and a sample audit event produced by a mutation in this feature area.',
    validityDays: 365,
  },
  {
    key: 'reports-metrics',
    order: 16,
    title: 'Reports, analytics and operational metrics',
    requirement:
      'Reports and metrics are reproducible, scoped to the tenant and match their source records.',
    evidenceStandard:
      'Report reconciliation to source totals, with metric definitions and the generation timestamp.',
    validityDays: 365,
  },
  {
    key: 'mobile-accessibility',
    order: 17,
    title: 'Mobile, offline and accessibility',
    requirement:
      'Critical flows work on mobile, offline changes reconcile and accessibility checks pass.',
    evidenceStandard:
      'Mobile and offline test results plus an accessibility audit covering the critical flows.',
    validityDays: 365,
  },
  {
    key: 'acceptance-release',
    order: 18,
    title: 'Acceptance tests and release gates',
    requirement:
      'A repeatable acceptance suite passes and the release gate records the approving owner.',
    evidenceStandard:
      'Acceptance run report with pass and fail counts, the tested revision and the release approval.',
    validityDays: 180,
  },
];

export function findControlGate(key: string): ControlGateDefinition | undefined {
  return CONTROL_GATE_DEFINITIONS.find((gate) => gate.key === key);
}

export function controlGateLabel(key: string): string {
  return findControlGate(key)?.title ?? key;
}

export interface ControlEvidenceSignal {
  readonly reviewStatus: ControlEvidenceReviewStatus;
  readonly expiresOn: string | null;
}

export interface ControlComplianceInput {
  readonly ownerUserId: string | null;
  readonly expiresOn: string | null;
  readonly evidence: readonly ControlEvidenceSignal[];
  /** ISO date (YYYY-MM-DD) the compliance decision is made for. */
  readonly today: string;
  readonly warningDays?: number;
}

export interface ControlComplianceResult {
  readonly status: ControlComplianceStatus;
  readonly reasons: readonly string[];
  readonly accepted: number;
  readonly pending: number;
  readonly rejected: number;
  readonly expired: number;
  /** Earliest future expiry among accepted evidence and the requirement, if any. */
  readonly nextExpiry: string | null;
}

function daysUntil(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

/**
 * Derives a gate's compliance status. Accepted evidence must be unexpired; an expiring requirement
 * or accepted evidence within the warning window is reported before it lapses. A pending review is
 * never treated as proof, and a rejected decision cannot satisfy the gate.
 */
export function controlGateCompliance(input: ControlComplianceInput): ControlComplianceResult {
  const warningDays = input.warningDays ?? CONTROL_COMPLIANCE_WARNING_DAYS;
  const accepted = input.evidence.filter((item) => item.reviewStatus === 'accepted');
  const pending = input.evidence.filter((item) => item.reviewStatus === 'pending');
  const rejected = input.evidence.filter((item) => item.reviewStatus === 'rejected');
  const expired = accepted.filter(
    (item) => item.expiresOn !== null && item.expiresOn < input.today,
  );
  const valid = accepted.filter((item) => item.expiresOn === null || item.expiresOn >= input.today);
  const nextExpiry =
    [
      ...valid.flatMap((item) => (item.expiresOn ? [item.expiresOn] : [])),
      ...(input.expiresOn && input.expiresOn >= input.today ? [input.expiresOn] : []),
    ].sort()[0] ?? null;

  const counts = {
    accepted: accepted.length,
    pending: pending.length,
    rejected: rejected.length,
    expired: expired.length,
  };

  if (input.expiresOn && input.expiresOn < input.today) {
    return {
      ...counts,
      status: 'expired',
      reasons: [`The requirement expired on ${input.expiresOn}.`],
      nextExpiry: null,
    };
  }

  if (valid.length > 0) {
    if (nextExpiry && daysUntil(input.today, nextExpiry) <= warningDays) {
      return {
        ...counts,
        status: 'expiring',
        reasons: [`Accepted evidence or the requirement expires on ${nextExpiry}.`],
        nextExpiry,
      };
    }
    return {
      ...counts,
      status: 'satisfied',
      reasons: [
        `${valid.length} accepted evidence item${valid.length === 1 ? '' : 's'} is current.`,
      ],
      nextExpiry,
    };
  }

  if (pending.length > 0) {
    return {
      ...counts,
      status: 'pending_review',
      reasons: [`${pending.length} evidence item${pending.length === 1 ? '' : 's'} awaits review.`],
      nextExpiry: null,
    };
  }

  if (expired.length > 0) {
    return {
      ...counts,
      status: 'expired',
      reasons: [
        `${expired.length} accepted evidence item${expired.length === 1 ? '' : 's'} has expired.`,
      ],
      nextExpiry: null,
    };
  }

  if (input.ownerUserId || input.expiresOn) {
    const reasons: string[] = [];
    if (input.ownerUserId) reasons.push('An owner is assigned.');
    if (input.expiresOn) reasons.push(`The requirement is due for refresh on ${input.expiresOn}.`);
    if (rejected.length > 0)
      reasons.push(
        `${rejected.length} evidence item${rejected.length === 1 ? ' was' : 's were'} rejected.`,
      );
    reasons.push('No accepted evidence is attached.');
    return { ...counts, status: 'in_progress', reasons, nextExpiry: null };
  }

  return {
    ...counts,
    status: 'missing',
    reasons: ['No owner, expiry or evidence is recorded.'],
    nextExpiry: null,
  };
}

export function controlComplianceLabel(status: ControlComplianceStatus): string {
  switch (status) {
    case 'missing':
      return 'Missing';
    case 'in_progress':
      return 'In progress';
    case 'pending_review':
      return 'Pending review';
    case 'satisfied':
      return 'Satisfied';
    case 'expiring':
      return 'Expiring';
    case 'expired':
      return 'Expired';
  }
}
