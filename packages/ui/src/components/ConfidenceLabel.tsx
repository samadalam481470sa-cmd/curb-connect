import { cx } from '../internal/cx';
import type { ConfidenceLevel } from '../types';
import { VisuallyHidden } from '../VisuallyHidden';

export const CONFIDENCE_PRESENTATION: Record<
  ConfidenceLevel,
  { label: string; description: string; rank: number }
> = {
  field_verified: {
    label: 'Field verified',
    description: 'Measured or confirmed on site.',
    rank: 3,
  },
  estimated_with_calibration: {
    label: 'Estimated with calibration',
    description: 'Derived from photos with a verified reference scale; carries calibration error.',
    rank: 2,
  },
  preliminary_visual_inference: {
    label: 'Preliminary visual inference',
    description: 'Inferred from images without verification. Budgetary use only.',
    rank: 1,
  },
  unavailable: {
    label: 'Unavailable',
    description: 'Not known. It cannot be inferred from the available evidence.',
    rank: 0,
  },
};

export interface ConfidenceLabelProps {
  level: ConfidenceLevel;
  /**
   * Whether a value exists for this dimension. AIQ-087-S: missing information is never labelled
   * confident because some other classification scored well, so `false` always renders
   * "Unavailable" whatever `level` says.
   */
  available?: boolean;
  /** The dimension this describes, e.g. "Curb height". Prefixes the accessible text. */
  dimension?: string;
  /** Evidence behind the label, e.g. "calibration error ±3.1% (2-point reference)". */
  detail?: string;
  /** Next best verification step, e.g. "Tape-measure the reveal on site". */
  nextStep?: string;
  className?: string;
}

/**
 * AIQ-087: a plain-language confidence label. It deliberately shows a category, not a raw model
 * score, and never implies that a confidence level guarantees price correctness (CV-050-D).
 */
export function ConfidenceLabel({
  level,
  available = true,
  dimension,
  detail,
  nextStep,
  className,
}: ConfidenceLabelProps) {
  const effective: ConfidenceLevel = available ? level : 'unavailable';
  const presentation = CONFIDENCE_PRESENTATION[effective];
  return (
    <span
      className={cx('fl-confidence', `fl-confidence--${effective}`, className)}
      data-level={effective}
    >
      <span className="fl-confidence__meter" aria-hidden="true">
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={cx(
              'fl-confidence__bar',
              step <= presentation.rank && 'fl-confidence__bar--on',
            )}
          />
        ))}
      </span>
      <span className="fl-confidence__text">
        {dimension && <VisuallyHidden>{`${dimension}: `}</VisuallyHidden>}
        <span className="fl-confidence__label">{presentation.label}</span>
        {detail && <span className="fl-confidence__detail">{detail}</span>}
        {nextStep && effective !== 'field_verified' && (
          <span className="fl-confidence__next">{`Next step: ${nextStep}`}</span>
        )}
      </span>
    </span>
  );
}
