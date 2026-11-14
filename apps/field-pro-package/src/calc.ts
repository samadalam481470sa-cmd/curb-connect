import {
  convertQuantity,
  curbCostLines,
  curbQuantities,
  type CurbRecipe,
  materialTakeoff,
  type MaterialSpec,
  type PriceBookItem,
  priceEstimate,
  type RoofLaborRate,
  roofCostLines,
  roofTakeoff,
  selectWaste,
  type WasteSelection,
} from '@fieldline/pricing';

export const EXAMPLE_PRICE_BOOK: PriceBookItem[] = [
  { code: 'saw_lf', unit: 'ft', rate: '20', revision: 'synthetic-book-2026.1' },
  { code: 'mob', unit: 'each', rate: '400', revision: 'synthetic-book-2026.1' },
  { code: 'breakout_lf', unit: 'ft', rate: '28', revision: 'synthetic-book-2026.1' },
  { code: 'disposal_load', unit: 'each', rate: '220', revision: 'synthetic-book-2026.1' },
  { code: 'replace_lf', unit: 'ft', rate: '95', revision: 'synthetic-book-2026.1' },
  { code: 'traffic', unit: 'each', rate: '350', revision: 'synthetic-book-2026.1' },
  { code: 'permit', unit: 'each', rate: '200', revision: 'synthetic-book-2026.1' },
];

export const PAGE60_RECIPE: CurbRecipe = {
  id: 'driveway-opening',
  version: '1.0.0',
  components: [
    {
      code: 'cutting',
      description: 'Saw cutting',
      category: 'labor',
      basis: 'cut_length_ft',
      priceItem: 'saw_lf',
      critical: true,
    },
    {
      code: 'mobilization',
      description: 'Mobilization',
      category: 'fixed',
      basis: 'fixed',
      priceItem: 'mob',
      critical: true,
    },
    {
      code: 'breakout',
      description: 'Breakout',
      category: 'labor',
      basis: 'cut_length_ft',
      priceItem: 'breakout_lf',
      critical: true,
    },
    {
      code: 'disposal',
      description: 'Haul-off and disposal',
      category: 'disposal',
      basis: 'fixed',
      priceItem: 'disposal_load',
      critical: true,
    },
    {
      code: 'replacement',
      description: 'Concrete replacement',
      category: 'subcontract',
      basis: 'restoration_length_ft',
      priceItem: 'replace_lf',
      critical: true,
    },
    {
      code: 'traffic_control',
      description: 'Traffic control',
      category: 'traffic_control',
      basis: 'fixed',
      priceItem: 'traffic',
      critical: true,
    },
    {
      code: 'permit_allowance',
      description: 'Permit allowance',
      category: 'permit',
      basis: 'fixed',
      priceItem: 'permit',
      critical: true,
      taxable: false,
    },
  ],
};

export const EXAMPLE_MATERIALS: MaterialSpec[] = [
  {
    code: 'shingles',
    description: 'Architectural shingles',
    materialClass: 'shingles',
    basis: { kind: 'sloped_area' },
    coveragePerPack: '33.3333333333333333333',
    packUnit: 'bundle',
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
];

export const EXAMPLE_LABOR: RoofLaborRate = {
  code: 'install_labor',
  description: 'Tear-off and install',
  ratePerSquare: '95',
  sourceRevision: 'example-labor-1 (synthetic)',
};

function waste(rate: string): WasteSelection {
  return selectWaste({
    recommendation: null,
    override: { wasteRate: rate, reason: 'package default', by: 'estimator' },
  });
}

export function computeCurbExample(cutLengthFt = '18') {
  const quantities = curbQuantities({
    segments: [{ id: 's1', kind: 'straight', length: cutLengthFt, unit: 'ft' }],
    sawPasses: 2,
    cutDepth: { state: 'known', value: '6', unit: 'in' },
    removalWidth: { state: 'known', value: '2', unit: 'ft' },
    crossSection: { state: 'known', value: '1.5', unit: 'ft2' },
    restorationLength: { state: 'known', value: cutLengthFt, unit: 'ft' },
    restorationWidth: { state: 'known', value: '2', unit: 'ft' },
  });
  const lines = curbCostLines(quantities, PAGE60_RECIPE, EXAMPLE_PRICE_BOOK);
  const estimate = priceEstimate({
    trade: 'curb',
    lines,
    recipe: 'driveway-opening@1.0.0',
    policy: {
      currency: 'USD',
      overheadRate: '0.10',
      price: { method: 'target_margin', marginRate: '0.25' },
      revision: 'package-1',
    },
  });
  return {
    cutLengthFt,
    directCost: estimate.scenarios?.base.directCost.amount ?? null,
    costBasis: estimate.scenarios?.base.costBasis.amount ?? null,
    total: estimate.scenarios?.base.total.amount ?? null,
    firm: estimate.firm,
    status: estimate.status,
    engineVersion: estimate.engineVersion,
  };
}

export function computeRoofExample() {
  const takeoff = roofTakeoff({
    facets: [300, 100, 200, 200, 100, 300].map((a, i) => ({
      id: `f${i}`,
      structureId: 'house',
      planAreaM2: convertQuantity(String(a), 'ft2', 'm2').toString(),
      pitch: { rise: 6, run: 12 },
    })),
    edgeLengthsM: {
      eave: convertQuantity('160', 'ft', 'm').toString(),
      ridge: convertQuantity('40', 'ft', 'm').toString(),
      hip: convertQuantity('75', 'ft', 'm').toString(),
      valley: convertQuantity('15', 'ft', 'm').toString(),
    },
  });
  const materials = materialTakeoff(takeoff, EXAMPLE_MATERIALS, {
    shingles: waste('0.10'),
    underlayment: waste('0'),
    ridge_cap: waste('0.10'),
  });
  const lines = roofCostLines(takeoff, materials, EXAMPLE_MATERIALS, [EXAMPLE_LABOR]);
  const estimate = priceEstimate({
    trade: 'roof',
    lines,
    recipe: 'roof-takeoff@1.0.0',
    policy: {
      currency: 'USD',
      overheadRate: '0.10',
      price: { method: 'markup', markupRate: '0.30' },
      revision: 'package-1',
    },
  });
  return {
    planFt2: convertQuantity(takeoff.property.planM2, 'm2', 'ft2').toString(),
    slopedFt2: takeoff.property.slopedFt2,
    squares: takeoff.property.squares,
    materialOrders: materials.map((m) => ({
      code: m.code,
      orderPacks: m.orderPacks,
      packUnit: m.packUnit,
      status: m.status,
    })),
    directCost: estimate.scenarios?.base.directCost.amount ?? null,
    total: estimate.scenarios?.base.total.amount ?? null,
    firm: estimate.firm,
    status: estimate.status,
    engineVersion: estimate.engineVersion,
  };
}

export const FieldProCalc = {
  computeCurbExample,
  computeRoofExample,
  VERSION: '1.0.0',
};

declare global {
  interface Window {
    FieldProCalc: typeof FieldProCalc;
  }
}

if (typeof globalThis !== 'undefined' && 'document' in globalThis) {
  (globalThis as unknown as Window).FieldProCalc = FieldProCalc;
}
