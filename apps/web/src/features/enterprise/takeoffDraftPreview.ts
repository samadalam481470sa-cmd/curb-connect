import { computeTakeoffLength, type EnterpriseTakeoffPoint } from '@fieldline/contracts';
import { computeTakeoffArea } from '@fieldline/geometry';

type SheetSize = { widthPoints: number; heightPoints: number };

export const takeoffQuantity = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 });

export function lengthDraftPreview(
  points: readonly (EnterpriseTakeoffPoint | null)[],
  scale: number | undefined,
  sheet: SheetSize,
) {
  const vertices = points.filter((point) => point !== null);
  const result = getPreview(() =>
    scale && vertices.length >= 2 && vertices.length === points.length
      ? computeTakeoffLength(vertices, scale, sheet)
      : null,
  );
  return { vertices, ...result };
}

export function areaDraftPreview(
  rings: readonly (readonly (EnterpriseTakeoffPoint | null)[])[],
  scale: number | undefined,
  sheet: SheetSize,
) {
  const [exterior = [], ...holes] = rings.map((ring) => ring.filter((point) => point !== null));
  const result = getPreview(() =>
    scale &&
    [exterior, ...holes].every(
      (points, index) => points.length >= 3 && points.length === rings[index]?.length,
    )
      ? computeTakeoffArea(exterior, holes, scale, sheet)
      : null,
  );
  return { exterior, holes, ...result };
}

function getPreview<T>(compute: () => T | null) {
  try {
    return { preview: compute(), previewError: '' };
  } catch (cause) {
    if (cause instanceof RangeError) return { preview: null, previewError: cause.message };
    throw cause;
  }
}
