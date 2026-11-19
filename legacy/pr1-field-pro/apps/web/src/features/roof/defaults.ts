// Contractor-editable example rates for the roof calculator demo. These are synthetic catalog
// figures from the pricing package fixtures — not market quotes.
import type { MaterialSpec, RoofLaborRate } from '@fieldline/pricing';

export const EXAMPLE_MATERIAL_SPECS: MaterialSpec[] = [
  {
    code: 'shingles',
    description: 'Architectural shingles',
    materialClass: 'shingles',
    basis: { kind: 'sloped_area' },
    coveragePerPack: '33.3333333333333333333',
    packUnit: 'bundle',
    sku: 'SYN-SH-1',
    unitPrice: '42.50',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: true,
  },
  {
    code: 'underlayment',
    description: 'Synthetic underlayment',
    materialClass: 'underlayment',
    basis: { kind: 'sloped_area' },
    coveragePerPack: '1000',
    packUnit: 'roll',
    unitPrice: '150',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: true,
  },
  {
    code: 'starter',
    description: 'Starter strip',
    materialClass: 'starter',
    basis: { kind: 'edges', edgeTypes: ['eave', 'rake'] },
    coveragePerPack: '100',
    packUnit: 'bundle',
    unitPrice: '60',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: false,
  },
  {
    code: 'ridge_cap',
    description: 'Ridge cap',
    materialClass: 'ridge_cap',
    basis: { kind: 'edges', edgeTypes: ['ridge', 'hip'] },
    coveragePerPack: '25',
    packUnit: 'bundle',
    unitPrice: '70',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: true,
  },
  {
    code: 'drip_edge',
    description: 'Drip edge 10 ft',
    materialClass: 'drip_edge',
    basis: { kind: 'edges', edgeTypes: ['eave', 'rake'] },
    coveragePerPack: '10',
    packUnit: 'piece',
    unitPrice: '12',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: false,
  },
  {
    code: 'valley',
    description: 'Valley metal',
    materialClass: 'valley',
    basis: { kind: 'edges', edgeTypes: ['valley'] },
    coveragePerPack: '10',
    packUnit: 'piece',
    unitPrice: '25',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: false,
  },
  {
    code: 'vents',
    description: 'Box vents',
    materialClass: 'vents',
    basis: { kind: 'count', count: '4' },
    coveragePerPack: '1',
    packUnit: 'each',
    unitPrice: '18',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: false,
  },
];

export const EXAMPLE_LABOR: RoofLaborRate = {
  code: 'install_labor',
  description: 'Tear-off and install',
  ratePerSquare: '95',
  sourceRevision: 'example-labor-1 (synthetic)',
};

/** Hip roof fixture matching packages/pricing trades.test hipTakeoff (1,200 plan sq ft @ 6/12). */
export const WORKED_EXAMPLE_LABEL =
  'Load worked example (1,200 sq ft hip @ 6/12 — contractor-editable example rates, not market quotes)';

export const WORKED_EXAMPLE_WASTE_PERCENT = '10';
