// Quantity takeoff and estimating. Quantities come from geometry; prices come from supplied
// catalog entries (never hard-coded here). Money is integer cents throughout.
import { segmentLength } from './validate';
import type { HomeDesign, BuildingElement } from './schema';

export type AssemblyRule = {
  /** Assembly id applied to elements with a matching `assemblyId`, or to all elements of `type`. */
  type: BuildingElement['type'];
  assemblyId?: string;
  /** Material/labor items priced per unit of the element's measure. */
  items: AssemblyItem[];
};

export type AssemblyItem = {
  sku: string;
  description: string;
  /** Which geometric measure the item scales with. */
  measure: 'area' | 'length' | 'count' | 'volume';
  /** Quantity per unit of measure (e.g. 4 studs per linear metre). */
  quantityPerUnit: number;
  unit: string;
  wastePercent: number;
  unitPriceCents: number;
  laborCentsPerUnit: number;
};

export type TakeoffLine = {
  elementId?: string;
  sku: string;
  description: string;
  quantity: number;
  unit: string;
  materialCents: number;
  laborCents: number;
  totalCents: number;
};

export type Estimate = {
  lines: TakeoffLine[];
  subtotalCents: number;
  contingencyCents: number;
  totalCents: number;
  budgetCents: number;
  overBudgetCents: number;
};

/** Measure an element in its unit of measure (metres, square metres, or count). */
export function measureElement(el: BuildingElement, measure: AssemblyItem['measure']): number {
  const length = segmentLength(el);
  switch (measure) {
    case 'length':
      return length;
    case 'area':
      return length * el.heightM;
    case 'volume':
      return length * el.thicknessM * el.heightM;
    case 'count':
      return 1;
  }
}

/** Round a non-negative finite number of cents to an integer. */
function centsOf(value: number): number {
  return Math.round(value);
}

/**
 * Build takeoff lines from geometry and assembly rules, then add a contingency and compare against
 * the project budget. `contingencyPercent` is applied to the subtotal.
 */
export function estimateDesign(
  design: HomeDesign,
  rules: AssemblyRule[],
  options: { contingencyPercent?: number } = {},
): Estimate {
  const contingencyPercent = options.contingencyPercent ?? 10;
  if (!Number.isFinite(contingencyPercent) || contingencyPercent < 0) {
    throw new RangeError('contingencyPercent must be a finite number >= 0');
  }

  const lines: TakeoffLine[] = [];
  for (const el of design.elements) {
    for (const rule of rules) {
      if (rule.type !== el.type) continue;
      if (rule.assemblyId !== undefined && rule.assemblyId !== el.assemblyId) continue;
      for (const item of rule.items) {
        const base = measureElement(el, item.measure) * item.quantityPerUnit;
        const quantity = base * (1 + item.wastePercent / 100);
        const materialCents = centsOf(quantity * item.unitPriceCents);
        const laborCents = centsOf(base * item.laborCentsPerUnit);
        lines.push({
          elementId: el.id,
          sku: item.sku,
          description: item.description,
          quantity,
          unit: item.unit,
          materialCents,
          laborCents,
          totalCents: materialCents + laborCents,
        });
      }
    }
  }

  const subtotalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  const contingencyCents = centsOf((subtotalCents * contingencyPercent) / 100);
  const totalCents = subtotalCents + contingencyCents;
  return {
    lines,
    subtotalCents,
    contingencyCents,
    totalCents,
    budgetCents: design.budgetCents,
    overBudgetCents: Math.max(0, totalCents - design.budgetCents),
  };
}
