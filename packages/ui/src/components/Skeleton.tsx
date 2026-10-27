import { cx } from '../internal/cx';
import { VisuallyHidden } from '../VisuallyHidden';

export interface SkeletonProps {
  /** Number of placeholder lines. */
  lines?: number;
  /** Announced to assistive tech; the placeholder bars themselves are hidden. */
  label?: string;
  variant?: 'text' | 'block' | 'card';
  className?: string;
}

/** Loading placeholder. Animation is disabled under prefers-reduced-motion (styles.css). */
export function Skeleton({
  lines = 3,
  label = 'Loading',
  variant = 'text',
  className,
}: SkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx('fl-skeleton', `fl-skeleton--${variant}`, className)}
    >
      <VisuallyHidden>{label}</VisuallyHidden>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <span key={i} className="fl-skeleton__line" aria-hidden="true" />
      ))}
    </div>
  );
}
