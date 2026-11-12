export const SHINGLE_OPTIONS = [
  { id: 'gaf_hdz', label: 'GAF Timberline HDZ · architectural', bundlesPerSquare: 3, source: 'https://www.gaf.com/en-us/roofing-materials/residential-roofing-materials/shingles/timberline-hdz' },
  { id: 'oc_duration', label: 'Owens Corning Duration · architectural', bundlesPerSquare: 3, source: 'https://www.owenscorning.com/en-us/roofing/shingles/trudefinition-duration' },
  { id: 'oc_storm', label: 'Owens Corning Duration STORM · impact resistant', bundlesPerSquare: 3, source: 'https://www.owenscorning.com/en-us/roofing/shingles/trudefinition-duration-storm' },
  { id: 'certainteed_landmark', label: 'CertainTeed Landmark · architectural', bundlesPerSquare: 3, source: 'https://www.buildsite.com/pdf/certainteed/Landmark-Shingles-Product-Data-2899919.pdf' },
  { id: 'custom', label: 'Other shingles · enter package coverage', bundlesPerSquare: null, source: '' },
] as const;

export type ShingleId = (typeof SHINGLE_OPTIONS)[number]['id'];

export interface ShingleQuote {
  bundles: number;
  shingleCost: number | null;
  laborCost: number | null;
  total: number | null;
}

/** 
 * Applies waste exactly once to measured sloped square footage, then rounds purchase packs up.
 * Blank unit prices are unknown, never treated as $0 or a live quote.
 */
export function computeShingleQuote(
  slopedSqFt: number,
  wastePercent: number,
  bundlesPerSquare: number,
  bundleUnitPrice: number | null,
  laborPerSquare: number | null,
): ShingleQuote {
  if (!Number.isFinite(slopedSqFt) || slopedSqFt < 0 ||
      !Number.isFinite(wastePercent) || wastePercent < 0 || wastePercent > 40 ||
      !Number.isFinite(bundlesPerSquare) || bundlesPerSquare <= 0 || bundlesPerSquare > 10) {
    throw new Error('Roof area, waste, or package coverage is invalid.');
  }
  for (const price of [bundleUnitPrice, laborPerSquare]) {
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1_000_000)) {
      throw new Error('Enter a nonnegative verified supplier or labor rate.');
    }
  }
  const squares = slopedSqFt / 100;
  const bundles = Math.ceil(squares * (1 + wastePercent / 100) * bundlesPerSquare - 1e-9);
  const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const shingleCost = bundleUnitPrice === null ? null : roundMoney(bundles * bundleUnitPrice);
  const laborCost = laborPerSquare === null ? null : roundMoney(squares * laborPerSquare);
  return {
    bundles,
    shingleCost,
    laborCost,
    total: shingleCost === null || laborCost === null ? null : roundMoney(shingleCost + laborCost),
  };
}
