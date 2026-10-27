/**
 * Shared UI-level types. Domain names mirror the conventions in the tech lead brief so they line
 * up with @fieldline/contracts; the UI keeps its own copies to stay free of runtime dependencies.
 */

/** Visual tone shared by pills, notices and toasts. Never the only carrier of meaning. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'review';

/** Where a value came from (brief: "Provenance sources"). */
export const PROVENANCE_SOURCES = [
  'machine_estimated',
  'imagery_derived',
  'user_entered',
  'field_verified',
  'survey_supplied',
] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

/** AIQ-087: user-facing confidence labels. Percentages are never shown as guarantees. */
export const CONFIDENCE_LEVELS = [
  'field_verified',
  'estimated_with_calibration',
  'preliminary_visual_inference',
  'unavailable',
] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/**
 * PLT-012-B: the four layers of an estimate that must stay visually distinct:
 * what was measured, what the software suggests, what the price rules assume, and what a person
 * approved.
 */
export const ESTIMATE_LAYERS = ['measured', 'suggested', 'assumption', 'approved'] as const;
export type EstimateLayer = (typeof ESTIMATE_LAYERS)[number];

/**
 * The standard non-ready variants every data-bearing component supports (PLT-012-D: loading,
 * empty, error and permission variants are part of the component contract).
 */
export type ViewState =
  | { status: 'ready' }
  | { status: 'loading'; label?: string }
  | { status: 'empty'; title: string; description?: string }
  | {
      status: 'error';
      title?: string;
      message: string;
      /** Shown so support can trace the failure (problem+json correlationId). */
      correlationId?: string;
      onRetry?: () => void;
    }
  | { status: 'permission_denied'; title?: string; message?: string };
