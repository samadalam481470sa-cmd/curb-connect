/** HVAC estimating core (Phase D, item 14).
 *
 * Sizing here is a planning estimate from editable rules of thumb (square feet per ton,
 * CFM per ton). It is NOT an engineered Manual J / Manual D calculation and must never be
 * presented as one; final equipment selection needs a load calculation for the building.
 *
 * Prices are contractor-entered only. A price of 0 means "not priced yet": the line keeps
 * its quantity, is flagged unpriced, and stays out of every total. Nothing is invented.
 */
export type SystemType = 'split_ac_gas' | 'split_heat_pump' | 'mini_split' | 'package_unit';
export type DuctScope = 'new_ductwork' | 'reuse_existing' | 'ductless';

export interface HvacSpec {
  customer: string;
  address: string;
  notes: string;
  conditionedSqFt: number;
  ceilingHeightFt: number;
  /** Editable assumption: conditioned sq ft served by one ton. Lower = more tons. */
  sqFtPerTon: number;
  /** Editable assumption: design airflow per ton. */
  cfmPerTon: number;
  systemType: SystemType;
  ductScope: DuctScope;
  ductLinearFt: number;
  supplyRegisters: number;
  returnGrilles: number;
  thermostats: number;
  zones: number;
  wastePercent: number;
  laborHours: number;
  laborRate: number;
  tripFee: number;
  taxPercent: number;
  /** Contractor-entered unit prices (USD). 0 = missing, never invented. */
  prices: {
    equipmentPerTon: number;
    ductPerLinearFt: number;
    registerEach: number;
    returnGrilleEach: number;
    thermostatEach: number;
    zoneKitEach: number;
  };
}

export const SYSTEM_LABELS: Record<SystemType, string> = {
  split_ac_gas: 'Split AC + gas furnace',
  split_heat_pump: 'Split heat pump',
  mini_split: 'Ductless mini-split',
  package_unit: 'Package unit',
};

export const DUCT_LABELS: Record<DuctScope, string> = {
  new_ductwork: 'New ductwork',
  reuse_existing: 'Reuse existing ducts (verify size/condition)',
  ductless: 'No ducts (ductless heads)',
};

export const DEFAULT_HVAC: HvacSpec = {
  customer: '', address: '', notes: '',
  conditionedSqFt: 2000, ceilingHeightFt: 9,
  sqFtPerTon: 500, cfmPerTon: 400,
  systemType: 'split_heat_pump', ductScope: 'new_ductwork',
  ductLinearFt: 120, supplyRegisters: 10, returnGrilles: 2,
  thermostats: 1, zones: 1, wastePercent: 5,
  laborHours: 24, laborRate: 0, tripFee: 0, taxPercent: 0,
  prices: {
    equipmentPerTon: 0, ductPerLinearFt: 0, registerEach: 0,
    returnGrilleEach: 0, thermostatEach: 0, zoneKitEach: 0,
  },
};

export interface HvacLine {
  id: string; label: string; qty: number; unit: string;
  /** null = contractor has not priced this line yet. */
  unitPrice: number | null; amount: number | null; detail: string;
}

export interface HvacQuote {
  tonsExact: number; tonsSelected: number; btuPerHour: number; designCfm: number;
  ductWithWasteFt: number; lines: HvacLine[];
  pricedSubtotal: number; tax: number; total: number;
  unpricedCount: number; assumptions: string[];
}

const moneyRound = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function safeNonnegative(value: unknown, max = 10_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, value));
}
const capped = (value: number, max: number) => safeNonnegative(value, max);

/** Round a tonnage up to the next half-ton equipment size (0.5 increments, min 1). */
export function selectTons(tonsExact: number): number {
  if (!Number.isFinite(tonsExact) || tonsExact <= 0) return 0;
  return Math.max(1, Math.ceil(tonsExact * 2) / 2);
}

export function computeHvacQuote(spec: HvacSpec): HvacQuote {
  const sqFt = capped(spec.conditionedSqFt, 1_000_000);
  const sqFtPerTon = Math.min(2000, Math.max(100, capped(spec.sqFtPerTon, 2000) || 500));
  const cfmPerTon = Math.min(600, Math.max(200, capped(spec.cfmPerTon, 600) || 400));
  const tonsExact = sqFt > 0 ? sqFt / sqFtPerTon : 0;
  const tonsSelected = selectTons(tonsExact);
  const btuPerHour = Math.round(tonsSelected * 12_000);
  const designCfm = Math.round(tonsSelected * cfmPerTon);
  const waste = Math.min(50, capped(spec.wastePercent, 50));
  const ductWithWasteFt = spec.ductScope === 'new_ductwork'
    ? moneyRound(capped(spec.ductLinearFt, 100_000) * (1 + waste / 100))
    : 0;

  const lines: HvacLine[] = [];
  const add = (id: string, label: string, qty: number, unit: string,
    unitPrice: number, detail: string) => {
    if (qty <= 0 || !Number.isFinite(qty)) return;
    const price = capped(unitPrice, 10_000_000);
    lines.push({
      id, label, qty, unit,
      unitPrice: price > 0 ? price : null,
      amount: price > 0 ? moneyRound(qty * price) : null,
      detail,
    });
  };

  if (tonsSelected > 0) {
    add('equipment', `${SYSTEM_LABELS[spec.systemType]} equipment`, tonsSelected, 'ton',
      spec.prices.equipmentPerTon,
      `${sqFt.toLocaleString()} ft² ÷ ${sqFtPerTon} ft²/ton = ${tonsExact.toFixed(2)} tons → ${tonsSelected} ton size (${btuPerHour.toLocaleString()} BTU/hr)`);
  }
  if (spec.ductScope === 'new_ductwork') {
    add('duct', 'Ductwork (with waste)', ductWithWasteFt, 'linear ft',
      spec.prices.ductPerLinearFt,
      `${capped(spec.ductLinearFt, 100_000)} ft + ${waste}% waste; design airflow ${designCfm.toLocaleString()} CFM`);
    add('registers', 'Supply registers', Math.round(capped(spec.supplyRegisters, 1000)),
      'each', spec.prices.registerEach, 'Count from floor plan; verify throw/size per room');
    add('returns', 'Return grilles', Math.round(capped(spec.returnGrilles, 1000)),
      'each', spec.prices.returnGrilleEach, 'Size returns for total CFM; verify filter access');
  }
  add('thermostats', 'Thermostats', Math.round(capped(spec.thermostats, 100)),
    'each', spec.prices.thermostatEach, 'One per zone unless zoning kit includes controls');
  const extraZones = Math.max(0, Math.round(capped(spec.zones, 50)) - 1);
  if (extraZones > 0) {
    add('zones', 'Additional zone kits', extraZones, 'each', spec.prices.zoneKitEach,
      'Dampers/controls per extra zone; bypass and static pressure need design check');
  }
  add('labor', 'Labor', capped(spec.laborHours, 10_000), 'crew hr', spec.laborRate,
    'Editable crew-time allowance');
  add('travel', 'Trip / mobilization fee', 1, 'visit', spec.tripFee,
    'Optional flat travel and equipment allowance');

  const pricedSubtotal = moneyRound(
    lines.reduce((sum, l) => sum + (l.amount ?? 0), 0));
  const tax = moneyRound(pricedSubtotal * capped(spec.taxPercent, 100) / 100);
  return {
    tonsExact: moneyRound(tonsExact), tonsSelected, btuPerHour, designCfm,
    ductWithWasteFt, lines, pricedSubtotal, tax,
    total: moneyRound(pricedSubtotal + tax),
    unpricedCount: lines.filter((l) => l.amount === null).length,
    assumptions: [
      `Sizing rule: 1 ton per ${sqFtPerTon} ft² of conditioned area (editable assumption, not a Manual J load calculation).`,
      `Airflow rule: ${cfmPerTon} CFM per ton (editable assumption, not a Manual D duct design).`,
      'Ceiling height, insulation, windows, orientation and infiltration are not modeled here; run a load calculation before ordering equipment.',
      'Prices are contractor-entered. Lines without a price are excluded from totals.',
    ],
  };
}

export function hvacQuoteCsv(spec: HvacSpec, quote: HvacQuote): string {
  const cell = (text: unknown) => {
    const str = String(text ?? '');
    const safe = /^[=+@\t\r\n]/.test(str) || /^-[^0-9]/.test(str) ? "'" + str : str;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows: (string | number)[][] = [
    ['HVAC estimate (planning only, not a load calculation)', spec.customer],
    ['Property', spec.address],
    ['System', SYSTEM_LABELS[spec.systemType]],
    ['Conditioned area (ft2)', spec.conditionedSqFt],
    ['Selected size (tons)', quote.tonsSelected],
    ['Design airflow (CFM)', quote.designCfm],
    ['Item', 'Quantity', 'Unit', 'Unit price (USD)', 'Amount (USD)'],
    ...quote.lines.map((l) => [l.label, l.qty, l.unit,
      l.unitPrice ?? 'not priced', l.amount ?? 'not priced']),
    ['Priced subtotal', '', '', '', quote.pricedSubtotal],
    ['Tax (check local treatment)', '', '', '', quote.tax],
    ['Total (priced lines only)', '', '', '', quote.total],
    ['Unpriced lines', quote.unpricedCount],
    ['Notes', spec.notes],
    ['Disclaimer', 'Preliminary estimate. Verify with a Manual J load calculation and local code before ordering.'],
  ];
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
