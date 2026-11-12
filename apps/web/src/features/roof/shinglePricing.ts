export const SHINGLE_OPTIONS = [
  { id: 'gaf_hdz', label: 'GAF Timberline HDZ · architectural asphalt', family:'asphalt', purchaseUnit:'bundle', bundlesPerSquare: 3, source: 'https://www.gaf.com/en-us/roofing-materials/residential-roofing-materials/shingles/timberline-hdz' },
  { id: 'oc_duration', label: 'Owens Corning Duration · asphalt', family:'asphalt', purchaseUnit:'bundle', bundlesPerSquare: 3, source: 'https://www.owenscorning.com/en-us/roofing/shingles/trudefinition-duration' },
  { id: 'oc_storm', label: 'Owens Corning Duration STORM · asphalt', family:'asphalt', purchaseUnit:'bundle', bundlesPerSquare: 3, source: 'https://www.owenscorning.com/en-us/roofing/shingles/trudefinition-duration-storm' },
  { id: 'certainteed_landmark', label: 'CertainTeed Landmark · asphalt', family:'asphalt', purchaseUnit:'bundle', bundlesPerSquare: 3, source: 'https://www.buildsite.com/pdf/certainteed/Landmark-Shingles-Product-Data-2899919.pdf' },
  { id: 'gaf_woodland', label: 'GAF Woodland · designer asphalt', family:'asphalt', purchaseUnit:'bundle', bundlesPerSquare: 4, source: 'https://www.gaf.com/en-us/blog/your-home/how-many-bundles-of-shingles-are-in-a-square---63a47862-f7e1-4e73-abcf-8d09917a8b8d' },
  { id: 'three_tab', label: 'Traditional 3-tab asphalt shingle', family:'asphalt', purchaseUnit:'bundle', bundlesPerSquare:null,source:'' },
  { id: 'designer_asphalt', label: 'Luxury / designer asphalt shingle', family:'asphalt',purchaseUnit:'bundle',bundlesPerSquare:null,source:'' },
  { id: 'impact_asphalt', label: 'Impact-rated asphalt shingle (specific SKU)',family:'asphalt',purchaseUnit:'bundle',bundlesPerSquare:null,source:'' },
  { id: 'solar_shingle', label: 'Building-integrated photovoltaic solar shingle',family:'solar',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'cedar_shingle', label: 'Western red cedar sawn shingle',family:'wood',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'cedar_shake', label: 'Cedar split shake',family:'wood',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'redwood_shingle',label:'Redwood shingle',family:'wood',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'cypress_shingle',label:'Cypress shingle',family:'wood',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'natural_slate',label:'Natural slate · general',family:'slate',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'welsh_slate',label:'Welsh natural slate',family:'slate',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'vermont_slate',label:'Vermont natural slate',family:'slate',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'synthetic_slate',label:'Composite / synthetic slate',family:'composite',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'composite_shake',label:'Polymer / composite shake',family:'composite',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'recycled_rubber',label:'Recycled-rubber roof shingle',family:'composite',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'metal_shingle_steel',label:'Steel stamped metal shingle',family:'metal',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'metal_shingle_aluminum',label:'Aluminum interlocking shingle',family:'metal',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'metal_shingle_copper',label:'Copper shingle',family:'metal',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'metal_shingle_zinc',label:'Zinc shingle',family:'metal',purchaseUnit:'piece',bundlesPerSquare:null,source:'' },
  { id: 'metal_standing_seam',label:'Standing-seam metal panel (not a shingle)',family:'metal',purchaseUnit:'panel',bundlesPerSquare:null,source:'' },
  { id: 'clay_barrel',label:'Clay barrel / Spanish tile',family:'tile',purchaseUnit:'tile',bundlesPerSquare:null,source:'' },
  { id: 'clay_flat',label:'Clay flat tile',family:'tile',purchaseUnit:'tile',bundlesPerSquare:null,source:'' },
  { id: 'concrete_stile',label:'Concrete S-profile tile',family:'tile',purchaseUnit:'tile',bundlesPerSquare:null,source:'' },
  { id: 'concrete_flat',label:'Concrete flat interlocking tile',family:'tile',purchaseUnit:'tile',bundlesPerSquare:null,source:'' },
  { id: 'fiber_cement',label:'Fiber-cement slate-look roof tile',family:'composite',purchaseUnit:'tile',bundlesPerSquare:null,source:'' },
  { id: 'custom', label: 'Custom roof covering · enter verified unit coverage',family:'other',purchaseUnit:'unit',bundlesPerSquare: null, source: '' },
] as const;

/** A category directory, not an exhaustive SKU inventory: manufacturers revise SKUs, exposure
 * and package sizes, and many slate/tile/metal systems are not sold in bundles. */
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
      !Number.isFinite(bundlesPerSquare) || bundlesPerSquare <= 0 || bundlesPerSquare > 1000) {
    throw new Error('Roof area, waste, or package coverage is invalid.');
  }
  for (const price of [bundleUnitPrice, laborPerSquare]) {
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1_000_000)) {
      throw new Error('Enter a nonnegative verified supplier or labor rate.');
    }
  }
  const squares = slopedSqFt / 100;
  const bundles = Math.max(0, Math.ceil(squares * (1 + wastePercent / 100) * bundlesPerSquare - 1e-9));
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
