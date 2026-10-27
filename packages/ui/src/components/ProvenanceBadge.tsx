import type { ReactNode } from 'react';
import { ImageIcon, PencilIcon, RulerIcon, ShieldIcon, SparkIcon } from '../icons';
import { cx } from '../internal/cx';
import type { ProvenanceSource } from '../types';

export const PROVENANCE_PRESENTATION: Record<
  ProvenanceSource,
  { label: string; description: string; measured: boolean; icon: (size: number) => ReactNode }
> = {
  machine_estimated: {
    label: 'Machine estimate',
    description: 'Suggested by software from photos or imagery. Verify before relying on it.',
    measured: false,
    icon: (size) => <SparkIcon size={size} />,
  },
  imagery_derived: {
    label: 'From imagery',
    description: 'Traced on licensed imagery; accuracy depends on image resolution and date.',
    measured: true,
    icon: (size) => <ImageIcon size={size} />,
  },
  user_entered: {
    label: 'Entered by user',
    description: 'Typed in by a team member; as reliable as their source.',
    measured: true,
    icon: (size) => <PencilIcon size={size} />,
  },
  field_verified: {
    label: 'Field verified',
    description: 'Measured or confirmed on site by a team member.',
    measured: true,
    icon: (size) => <RulerIcon size={size} />,
  },
  survey_supplied: {
    label: 'Survey supplied',
    description: 'Taken from a supplied survey, plan or engineering document.',
    measured: true,
    icon: (size) => <ShieldIcon size={size} />,
  },
};

/** True for sources that represent a measurement rather than a software estimate. */
export function isMeasuredSource(source: ProvenanceSource): boolean {
  return PROVENANCE_PRESENTATION[source].measured;
}

export interface ProvenanceBadgeProps {
  source: ProvenanceSource;
  /** Extra evidence, e.g. "Tape, 2026-10-20, J. Ortiz" or "Model curb-v0 (disabled)". */
  detail?: string;
  /** Show only the icon + short label; the full description stays available to screen readers. */
  compact?: boolean;
  className?: string;
}

/**
 * Shows where a value came from (brief: provenance sources). Estimated sources use a dashed
 * outline and measured ones a solid outline, so the distinction survives grayscale printing and
 * color-blindness; the text label is always present.
 */
export function ProvenanceBadge({
  source,
  detail,
  compact = false,
  className,
}: ProvenanceBadgeProps) {
  const presentation = PROVENANCE_PRESENTATION[source];
  return (
    <span
      className={cx(
        'fl-provenance',
        `fl-provenance--${source}`,
        presentation.measured ? 'fl-provenance--measured' : 'fl-provenance--estimated',
        compact && 'fl-provenance--compact',
        className,
      )}
      data-source={source}
      title={detail ? `${presentation.description} ${detail}` : presentation.description}
    >
      {presentation.icon(14)}
      <span className="fl-provenance__label">{presentation.label}</span>
      {detail && !compact && <span className="fl-provenance__detail">{detail}</span>}
    </span>
  );
}
