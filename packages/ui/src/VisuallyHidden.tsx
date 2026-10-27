import type { ComponentPropsWithoutRef } from 'react';

const hiddenStyle = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  height: 1,
  margin: -1,
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: 1,
} as const;

/**
 * PLT-012: text that screen readers announce but sighted users do not see, e.g. the unit name
 * behind an abbreviated measurement ("ft" -> "feet") or the meaning of an icon-only button.
 */
export function VisuallyHidden({ style, ...props }: ComponentPropsWithoutRef<'span'>) {
  return <span {...props} style={{ ...hiddenStyle, ...style }} />;
}
