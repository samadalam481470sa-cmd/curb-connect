// Page-60 style curb recipe and synthetic price book from packages/pricing trades.test.
// Clearly labeled as contractor-editable example rates — not market quotes.
import type { CurbRecipe, PriceBookItem } from '@fieldline/pricing';

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

export const WORKED_EXAMPLE_LABEL =
  'Load worked example (CP-060 page-60: 18 ft driveway opening — example rates, not market quotes)';

export const WORKED_EXAMPLE = {
  cutLengthFt: '18',
  segmentCount: 1,
  sawPasses: 2,
  depthMode: 'known' as const,
  depthIn: '6',
  depthLowIn: '6',
  depthBaseIn: '7',
  depthHighIn: '9',
  removalWidthFt: '2',
  crossSectionFt2: '1.5',
  overheadPercent: '10',
  marginPercent: '25',
};
