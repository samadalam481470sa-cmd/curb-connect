import { z } from 'zod';

/**
 * RFC 9457 problem+json body used by every API error (BE-073, docs/architecture.md "API
 * conventions"). `code` is a stable machine-readable identifier from ERROR_CODES below;
 * `correlationId` always equals the X-Request-Id response header.
 */
export const ProblemFieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});

export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  code: z.string(),
  correlationId: z.string(),
  retryable: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  errors: z.array(ProblemFieldErrorSchema).optional(),
});

export type Problem = z.infer<typeof ProblemSchema>;
export type ProblemFieldError = z.infer<typeof ProblemFieldErrorSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Base for `type` URIs. They identify the code; nothing needs to be served there. */
export const PROBLEM_TYPE_BASE = 'https://errors.fieldline.invalid/';

export interface ErrorCodeDefinition {
  status: number;
  title: string;
  retryable: boolean;
  /** Help text safe to show to any user; never contains tenant data. */
  hint: string;
}

/**
 * BE-073 error taxonomy. Codes are stable: add new ones, never repurpose an existing one.
 * Domain gates (gate_*) use 409 when the resource state blocks the action and 422 when the
 * request itself is incomplete.
 */
export const ERROR_CODES = {
  // generic
  bad_request: { status: 400, title: 'Bad request', retryable: false, hint: 'Check the request.' },
  validation_failed: {
    status: 400,
    title: 'Validation failed',
    retryable: false,
    hint: 'Correct the highlighted fields.',
  },
  unauthenticated: {
    status: 401,
    title: 'Sign-in required',
    retryable: false,
    hint: 'Sign in again to continue.',
  },
  session_expired: {
    status: 401,
    title: 'Session expired',
    retryable: false,
    hint: 'Your session ended. Sign in again; unsaved drafts stay on this device.',
  },
  forbidden: {
    status: 403,
    title: 'Not allowed',
    retryable: false,
    hint: 'Your role does not allow this action. Ask an owner or admin.',
  },
  workspace_required: {
    status: 403,
    title: 'Choose a workspace',
    retryable: false,
    hint: 'You belong to several companies. Pick one before continuing.',
  },
  membership_revoked: {
    status: 403,
    title: 'Access removed',
    retryable: false,
    hint: 'Your access to this company was removed.',
  },
  origin_rejected: {
    status: 403,
    title: 'Cross-site request blocked',
    retryable: false,
    hint: 'Reload the app and try again.',
  },
  not_found: { status: 404, title: 'Not found', retryable: false, hint: 'The record does not exist.' },
  method_not_allowed: {
    status: 405,
    title: 'Method not allowed',
    retryable: false,
    hint: 'Unsupported operation.',
  },
  conflict: {
    status: 409,
    title: 'Conflict',
    retryable: false,
    hint: 'The record changed. Review the latest version.',
  },
  invalid_transition: {
    status: 409,
    title: 'Action not available in this state',
    retryable: false,
    hint: 'The record is in a state that does not allow this step.',
  },
  immutable_record: {
    status: 409,
    title: 'Record is locked',
    retryable: false,
    hint: 'Approved, issued and signed records cannot change. Create a new revision.',
  },
  revision_conflict: {
    status: 409,
    title: 'Edited elsewhere',
    retryable: false,
    hint: 'Someone saved a newer version. Review the differences before saving again.',
  },
  duplicate: {
    status: 409,
    title: 'Already exists',
    retryable: false,
    hint: 'A matching record already exists.',
  },
  precondition_failed: {
    status: 412,
    title: 'Stale revision',
    retryable: false,
    hint: 'Reload to get the latest revision, then retry.',
  },
  precondition_required: {
    status: 428,
    title: 'If-Match required',
    retryable: false,
    hint: 'Send the current revision in If-Match.',
  },
  payload_too_large: {
    status: 413,
    title: 'File too large',
    retryable: false,
    hint: 'Upload a smaller file.',
  },
  unsupported_media_type: {
    status: 415,
    title: 'Unsupported file type',
    retryable: false,
    hint: 'Upload a JPEG, PNG, HEIC, WebP or PDF file.',
  },
  idempotency_key_required: {
    status: 400,
    title: 'Idempotency-Key required',
    retryable: false,
    hint: 'Send an Idempotency-Key header with this request.',
  },
  idempotency_key_reused: {
    status: 422,
    title: 'Idempotency-Key reused with a different body',
    retryable: false,
    hint: 'Use a new key for a different request.',
  },
  idempotency_in_progress: {
    status: 409,
    title: 'Request still processing',
    retryable: true,
    hint: 'The original request is still running. Retry shortly.',
  },
  rate_limited: { status: 429, title: 'Too many requests', retryable: true, hint: 'Wait and retry.' },
  internal: {
    status: 500,
    title: 'Unexpected error',
    retryable: true,
    hint: 'Something went wrong. Quote the reference when contacting support.',
  },
  dependency_unavailable: {
    status: 503,
    title: 'Service temporarily unavailable',
    retryable: true,
    hint: 'A provider is unavailable. Existing work is safe; retry later.',
  },
  feature_unavailable: {
    status: 403,
    title: 'Feature unavailable',
    retryable: false,
    hint: 'This feature is not enabled for your company yet.',
  },
  // entitlements and billing
  entitlement_exceeded: {
    status: 402,
    title: 'Plan limit reached',
    retryable: false,
    hint: 'Your plan has no remaining credits for this action.',
  },
  payment_provider_error: {
    status: 502,
    title: 'Payment provider error',
    retryable: true,
    hint: 'The payment provider did not respond. No charge was recorded.',
  },
  webhook_signature_invalid: {
    status: 400,
    title: 'Invalid webhook signature',
    retryable: false,
    hint: 'Webhook rejected.',
  },
  // imagery and media
  imagery_rights_denied: {
    status: 403,
    title: 'Imagery license does not allow this use',
    retryable: false,
    hint: 'This imagery source cannot be used for analysis, caching or export.',
  },
  imagery_license_expired: {
    status: 409,
    title: 'Imagery license expired',
    retryable: false,
    hint: 'Select newer licensed imagery or upload your own.',
  },
  media_rejected: {
    status: 422,
    title: 'Photo rejected',
    retryable: false,
    hint: 'Replace only this photo; the rest of the job is kept.',
  },
  upload_expired: {
    status: 410,
    title: 'Upload link expired',
    retryable: false,
    hint: 'Request a new upload link.',
  },
  checksum_mismatch: {
    status: 422,
    title: 'File checksum mismatch',
    retryable: false,
    hint: 'The upload was corrupted. Retry the upload.',
  },
  // geometry and measurement
  geometry_invalid: {
    status: 422,
    title: 'Geometry is invalid',
    retryable: false,
    hint: 'Fix self-intersections, zero-area or duplicate facets before pricing.',
  },
  calibration_failed: {
    status: 422,
    title: 'Calibration failed',
    retryable: false,
    hint: 'The reference is unreliable. Enter field dimensions instead.',
  },
  measurement_unknown: {
    status: 422,
    title: 'Required measurement missing',
    retryable: false,
    hint: 'A required dimension is unknown. Measure it on site or mark the estimate budgetary.',
  },
  address_ambiguous: {
    status: 422,
    title: 'Confirm the building',
    retryable: false,
    hint: 'Several buildings match this address. Choose the ones in scope.',
  },
  // gating (CP-059, OPS-067)
  gate_blocked: {
    status: 409,
    title: 'Approval blocked',
    retryable: false,
    hint: 'Resolve the listed blockers (permits, utilities, depth, reviews) first.',
  },
  approval_separation_of_duties: {
    status: 403,
    title: 'Separate approver required',
    retryable: false,
    hint: 'Company policy requires a different person to approve.',
  },
  dispatch_blocked: {
    status: 409,
    title: 'Cannot dispatch',
    retryable: false,
    hint: 'Permits, utility checks, safety reviews or the signed contract are missing.',
  },
  price_unavailable: {
    status: 409,
    title: 'Price missing or stale',
    retryable: false,
    hint: 'A critical line has no approved price. It is marked for review, not priced at $0.',
  },
  proposal_not_executable: {
    status: 409,
    title: 'Proposal is budgetary',
    retryable: false,
    hint: 'A budgetary proposal cannot be accepted until gating is satisfied.',
  },
  portal_link_invalid: {
    status: 404,
    title: 'Link not available',
    retryable: false,
    hint: 'This link expired or was revoked. Ask your contractor for a new one.',
  },
} as const satisfies Record<string, ErrorCodeDefinition>;

export type ErrorCode = keyof typeof ERROR_CODES;
export const ERROR_CODE_KEYS = Object.keys(ERROR_CODES) as ErrorCode[];
export const ErrorCodeSchema = z.enum(ERROR_CODE_KEYS as [ErrorCode, ...ErrorCode[]]);

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CODES, value);
}

export function problemTypeFor(code: ErrorCode): string {
  return `${PROBLEM_TYPE_BASE}${code.replaceAll('_', '-')}`;
}

/** Builds a problem body for a code; the API adds correlationId from the request. */
export function problemFor(
  code: ErrorCode,
  correlationId: string,
  extras: Partial<Pick<Problem, 'detail' | 'errors' | 'retryAfterSeconds'>> = {},
): Problem {
  const def: ErrorCodeDefinition = ERROR_CODES[code];
  return {
    type: problemTypeFor(code),
    title: def.title,
    status: def.status,
    code,
    correlationId,
    retryable: def.retryable,
    ...extras,
  };
}
