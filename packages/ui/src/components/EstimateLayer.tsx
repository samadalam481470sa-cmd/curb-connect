import { useId, type ReactNode } from 'react';
import { cx } from '../internal/cx';
import type { EstimateLayer } from '../types';

export const ESTIMATE_LAYER_PRESENTATION: Record<EstimateLayer, { title: string; marker: string }> =
  {
    measured: { title: 'Measured inputs', marker: 'Measured' },
    suggested: { title: 'Suggested quantities', marker: 'Suggested' },
    assumption: { title: 'Pricing assumptions', marker: 'Assumption' },
    approved: { title: 'Approved output', marker: 'Approved' },
  };

/**
 * PLT-012-B visual-separation rule: measured inputs, software-suggested quantities, pricing
 * assumptions and approved output each live in their own labelled section with its own color
 * band AND a text marker, so the difference never depends on color alone.
 */
export function EstimateLayerSection({
  layer,
  title,
  children,
  className,
}: {
  layer: EstimateLayer;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const p = ESTIMATE_LAYER_PRESENTATION[layer];
  return (
    <section
      aria-labelledby={id}
      data-layer={layer}
      className={cx('fl-layer', `fl-layer--${layer}`, className)}
    >
      <h3 className="fl-layer__title" id={id}>
        <span className="fl-layer__marker">{p.marker}</span>
        {title ?? p.title}
      </h3>
      {children}
    </section>
  );
}
