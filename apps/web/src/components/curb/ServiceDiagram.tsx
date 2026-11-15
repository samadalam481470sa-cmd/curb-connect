// Original, illustrative plan-view diagrams of each curb service (CV-041). They explain the scope
// in plain shapes (street, gutter, curb, sidewalk, saw cuts); they are not to scale and never
// used for measurement.
import type { CurbServiceCode } from '@fieldline/contracts';
import type { ReactNode } from 'react';

const W = 160;
const H = 96;

function Base() {
  return (
    <>
      <rect x="0" y="62" width={W} height="34" fill="var(--curb-dg-road)" />
      <rect x="0" y="54" width={W} height="8" fill="var(--curb-dg-gutter)" />
      <rect x="0" y="46" width={W} height="8" fill="var(--curb-dg-curb)" />
      <rect x="0" y="22" width={W} height="24" fill="var(--curb-dg-walk)" />
      <rect x="0" y="0" width={W} height="22" fill="var(--curb-dg-yard)" />
    </>
  );
}

const cut = { stroke: 'var(--curb-dg-cut)', strokeWidth: 2.5, strokeDasharray: '5 3', fill: 'none' } as const;
const fill = { fill: 'var(--curb-dg-work)', opacity: 0.85 } as const;

const SHAPES: Record<CurbServiceCode, () => ReactNode> = {
  driveway_opening: () => (
    <>
      <rect x="55" y="0" width="50" height="46" fill="var(--curb-dg-drive)" />
      <path d="M45 46 L55 54 L105 54 L115 46" {...fill} />
      <path d="M45 46 L55 54 L105 54 L115 46" {...cut} />
    </>
  ),
  curb_shaving: () => (
    <>
      <rect x="40" y="46" width="80" height="8" {...fill} />
      <line x1="40" y1="50" x2="120" y2="50" {...cut} />
    </>
  ),
  curb_removal_replacement: () => (
    <>
      <rect x="45" y="46" width="70" height="8" {...fill} />
      <line x1="45" y1="42" x2="45" y2="58" {...cut} />
      <line x1="115" y1="42" x2="115" y2="58" {...cut} />
    </>
  ),
  gutter_replacement: () => (
    <>
      <rect x="35" y="54" width="90" height="8" {...fill} />
      <path d="M40 58 h80" stroke="var(--curb-dg-water)" strokeWidth="1.5" markerEnd="url(#curb-arrow)" />
    </>
  ),
  sidewalk_ramp_transition: () => (
    <>
      <path d="M60 22 L100 22 L110 54 L50 54 Z" {...fill} />
      <path d="M60 22 L50 54 M100 22 L110 54" {...cut} />
    </>
  ),
  private_curb_cut: () => (
    <>
      <rect x="0" y="62" width={W} height="34" fill="var(--curb-dg-lot)" />
      <rect x="55" y="46" width="50" height="8" {...fill} />
      <line x1="55" y1="42" x2="55" y2="58" {...cut} />
      <line x1="105" y1="42" x2="105" y2="58" {...cut} />
    </>
  ),
  other_concrete_cut: () => (
    <>
      <text x={W / 2} y="40" textAnchor="middle" fontSize="22" fill="var(--curb-dg-cut)">?</text>
      <rect x="50" y="22" width="60" height="32" {...cut} />
    </>
  ),
};

export function ServiceDiagram({ code, title }: { code: CurbServiceCode; title: string }) {
  const Shape = SHAPES[code];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Illustration: ${title} (not to scale)`} className="curb-diagram">
      <defs>
        <marker id="curb-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="var(--curb-dg-water)" />
        </marker>
      </defs>
      <Base />
      <Shape />
    </svg>
  );
}
