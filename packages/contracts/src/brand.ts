/**
 * STR-001 / STR-009: the product name lives in exactly one place. UI copy, PDFs, emails, the
 * OpenAPI title and the PWA manifest all read it from here, so a rename is a one-line change.
 * The two product names are deliberately equal peers (PLT-011: equal navigation prominence).
 */
export const BRAND = {
  name: 'Field Pro',
  shortName: 'Field Pro',
  description: 'Roof measurements and concrete curb cutting estimates for contractors.',
  products: {
    roof: 'Roof Measurements',
    curb: 'Curb Cutting',
  },
} as const;

export type Brand = typeof BRAND;

/** The one product name constant (STR-009). */
export const BRAND_NAME = BRAND.name;
