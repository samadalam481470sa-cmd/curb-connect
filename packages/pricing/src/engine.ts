// Shared pricing service for both trades (BO-065 B, CP-052, CP-058). Trade recipes (roof, curb)
// turn quantities into cost lines; this engine prices them with ONE order of operations:
//
//   1. line extension      quantity x unit rate, rounded per line            [line_extension]
//   2. surcharges          complexity % of the lines they target             [surcharge]
//   3. direct cost         sum of lines + surcharges
//   4. overhead            direct x overheadRate                             [overhead]
//   5. contingency         (direct + overhead) x contingencyRate             [contingency]
//   6. cost basis          direct + overhead + contingency
//   7. price               markup: basis x (1 + k)  OR  margin: basis / (1 - m)  (never both) [price]
//   8. discounts           in listed order; % applies to the running amount  [discount]
//   9. minimum charge      raise pre-tax subtotal to the minimum job charge  [minimum_charge]
//  10. tax                 pre-tax subtotal (or taxable-line share) x rate, unless exempt [tax]
//  11. total               subtotal + tax
//
// Unknown values never become $0: a critical line without quantity or price makes the estimate
// `pending_review` with no totals. Bounded inputs yield low/base/high scenarios and a non-firm
// estimate, with the inputs that widen the range listed (CP-058).
import {
  type Currency,
  dec,
  type DecimalInput,
  fmt,
  type Money,
  money,
  ONE,
  PricingDecimal,
  PricingError,
  rate,
  type RoundingRecord,
  RoundingLog,
  ZERO,
} from './decimal';
import { ENGINE_VERSION } from './version';

export type Trade = 'roof' | 'curb';
export type Scenario = 'low' | 'base' | 'high';
export const SCENARIOS: readonly Scenario[] = ['low', 'base', 'high'];

export type CostCategory =
  | 'labor'
  | 'material'
  | 'equipment'
  | 'disposal'
  | 'subcontract'
  | 'fixed'
  | 'allowance'
  | 'permit'
  | 'traffic_control';
export type Confidence = 'high' | 'medium' | 'low';

/** A value bounded by documented assumptions (CP-058): low <= base <= high. */
export interface Bounded {
  readonly low: DecimalInput;
  readonly base: DecimalInput;
  readonly high: DecimalInput;
  /** Why it is uncertain, e.g. "buried depth unverified: 6-9 in". */
  readonly reason: string;
}

export type ValueInput = DecimalInput | Bounded;

export function isBounded(v: ValueInput | null | undefined): v is Bounded {
  return typeof v === 'object' && v !== null && !(v instanceof PricingDecimal) && 'base' in v;
}

export function scenarioValue(v: ValueInput, s: Scenario, field: string): PricingDecimal {
  if (!isBounded(v)) return dec(v, field);
  const low = dec(v.low, `${field}.low`);
  const base = dec(v.base, `${field}.base`);
  const high = dec(v.high, `${field}.high`);
  if (low.gt(base) || base.gt(high))
    throw new PricingError('invalid_bounds', `${field}: need low <= base <= high`);
  return s === 'low' ? low : s === 'high' ? high : base;
}

export interface CostLineInput {
  readonly code: string;
  readonly description: string;
  readonly category: CostCategory;
  /** null = unknown quantity. */
  readonly quantity: ValueInput | null;
  readonly unit: string;
  /** null = unpriced (no catalog rate). */
  readonly unitRate: ValueInput | null;
  /** Critical components block pricing when unresolved (CP-052 S). */
  readonly critical: boolean;
  readonly taxable?: boolean;
  /** Price-book / catalog revision the rate came from. */
  readonly sourceRevision: string | null;
  /** Version of the recipe/formula that produced the quantity. */
  readonly formulaVersion: string;
  readonly confidence: Confidence;
  /** Human-readable derivation, e.g. "18 ft cut line x $20.00/ft". */
  readonly formula: string;
  /** Optional reason when quantity/rate is null. */
  readonly unresolvedReason?: string;
}

export interface Surcharge {
  readonly code: string;
  readonly description: string;
  /** Fraction, e.g. 0.15 = 15%. */
  readonly rate: ValueInput;
  /** Line codes the surcharge applies to; omitted = every priced line. */
  readonly appliesTo?: readonly string[];
  readonly sourceRevision: string | null;
}

export type PriceMethod =
  | {
      readonly method: 'markup';
      /** k: price = basis x (1 + k). */ readonly markupRate: DecimalInput;
    }
  | {
      readonly method: 'target_margin';
      /** m: price = basis / (1 - m), 0 <= m < 1. */ readonly marginRate: DecimalInput;
    }
  | { readonly method: 'cost_plus_none' };

export interface Discount {
  readonly code: string;
  readonly kind: 'percent' | 'amount';
  /** percent: fraction (0.05 = 5%); amount: money. */
  readonly value: DecimalInput;
  readonly reason: string;
}

export interface TaxPolicy {
  readonly rate: DecimalInput;
  /** subtotal: whole pre-tax price; taxable_share: subtotal x (taxable direct / direct). */
  readonly basis?: 'subtotal' | 'taxable_share';
  readonly exemption?: { readonly certificateId: string; readonly reason: string } | null;
  readonly jurisdiction?: string;
}

export interface PricingPolicy {
  readonly currency: Currency;
  readonly overheadRate?: DecimalInput;
  readonly contingencyRate?: DecimalInput;
  readonly price: PriceMethod;
  readonly discounts?: readonly Discount[];
  /** Minimum job charge (pre-tax). */
  readonly minimumCharge?: DecimalInput | null;
  readonly tax?: TaxPolicy | null;
  /** Discounting below this realized gross margin needs approval. */
  readonly marginFloor?: DecimalInput | null;
  /** (high - low) / base above this requires site verification before a binding proposal. */
  readonly uncertaintyThreshold?: DecimalInput | null;
  /** Policy revision id recorded on output. */
  readonly revision: string;
}

export interface EstimateInput {
  readonly trade: Trade;
  readonly lines: readonly CostLineInput[];
  readonly surcharges?: readonly Surcharge[];
  readonly policy: PricingPolicy;
  /** The recipe that produced the lines, e.g. "curb.standard@1.0.0". */
  readonly recipe: string;
}

export interface PricedLine {
  readonly code: string;
  readonly description: string;
  readonly category: CostCategory;
  readonly unit: string;
  readonly status: 'priced' | 'unresolved';
  readonly critical: boolean;
  readonly quantity: Readonly<Record<Scenario, string>> | null;
  readonly unitRate: Readonly<Record<Scenario, string>> | null;
  readonly extended: Readonly<Record<Scenario, Money>> | null;
  readonly sourceRevision: string | null;
  readonly formulaVersion: string;
  readonly confidence: Confidence;
  readonly formula: string;
  readonly unresolvedReason: string | null;
}

export interface Breakdown {
  readonly directCost: Money;
  readonly surcharges: readonly { readonly code: string; readonly amount: Money }[];
  readonly overhead: Money;
  readonly contingency: Money;
  readonly costBasis: Money;
  readonly priceBeforeDiscounts: Money;
  readonly discounts: readonly {
    readonly code: string;
    readonly amount: Money;
    readonly reason: string;
  }[];
  readonly minimumChargeAdjustment: Money;
  readonly subtotal: Money;
  readonly tax: Money;
  readonly total: Money;
  /** (subtotal - costBasis) / subtotal, 4 dp; null when subtotal is 0. */
  readonly grossMargin: string | null;
  /** (subtotal - costBasis) / costBasis, 4 dp; null when cost basis is 0. */
  readonly markupOnCost: string | null;
  readonly rounding: readonly RoundingRecord[];
}

export interface RangeDriver {
  readonly lineCode: string;
  readonly input: 'quantity' | 'unitRate' | 'surcharge';
  readonly reason: string;
  /** Direct-cost swing (high - low) when only this input varies. */
  readonly directCostSwing: string;
}

export interface EstimateResult {
  readonly engineVersion: string;
  readonly trade: Trade;
  readonly recipe: string;
  readonly policyRevision: string;
  readonly currency: Currency;
  readonly status: 'priced' | 'pending_review';
  /** True only when no bounded input remains: a single firm figure may be shown. */
  readonly firm: boolean;
  readonly lines: readonly PricedLine[];
  /** null when pending review: unresolved critical components are never shown as $0. */
  readonly scenarios: Readonly<Record<Scenario, Breakdown>> | null;
  readonly rangeDrivers: readonly RangeDriver[];
  readonly flags: readonly { readonly code: string; readonly message: string }[];
}

function triple<T>(f: (s: Scenario) => T): Record<Scenario, T> {
  return { low: f('low'), base: f('base'), high: f('high') };
}

/** Validate and normalize the policy; markup and margin are exclusive by construction. */
function policyRates(policy: PricingPolicy) {
  const overhead = rate(policy.overheadRate ?? 0, 'overheadRate');
  const contingency = rate(policy.contingencyRate ?? 0, 'contingencyRate');
  const p = policy.price as PriceMethod & { markupRate?: unknown; marginRate?: unknown };
  if (p.markupRate !== undefined && p.marginRate !== undefined) {
    throw new PricingError('markup_and_margin', 'apply EITHER markup OR target margin, never both');
  }
  if (p.method === 'target_margin') {
    const m = rate(p.marginRate as DecimalInput, 'marginRate');
    if (m.gte(ONE)) throw new PricingError('rate_out_of_range', 'marginRate must be < 1');
  } else if (p.method === 'markup') {
    rate(p.markupRate as DecimalInput, 'markupRate', 100);
  } else if (p.method !== 'cost_plus_none') {
    throw new PricingError(
      'invalid_policy',
      `unknown price method ${String((p as { method: string }).method)}`,
    );
  }
  return { overhead, contingency };
}

export function priceEstimate(input: EstimateInput): EstimateResult {
  const { policy } = input;
  const currency = policy.currency;
  const { overhead: overheadRate, contingency: contingencyRate } = policyRates(policy);
  const flags: { code: string; message: string }[] = [];
  const codes = new Set<string>();
  for (const l of input.lines) {
    if (codes.has(l.code))
      throw new PricingError('duplicate_line', `duplicate line code ${l.code}`);
    codes.add(l.code);
  }

  // 1. Line extensions per scenario.
  const logs = triple(() => new RoundingLog(currency));
  let pending = false;
  let bounded = false;
  const lines: PricedLine[] = input.lines.map((l) => {
    const unresolved = l.quantity === null || l.unitRate === null;
    if (unresolved) {
      const reason =
        l.unresolvedReason ?? (l.quantity === null ? 'quantity unknown' : 'no approved unit rate');
      if (l.critical) {
        pending = true;
        flags.push({
          code: 'unpriced_critical_component',
          message: `${l.code}: ${reason}; pending review (never $0)`,
        });
      } else {
        flags.push({
          code: 'unresolved_optional_line',
          message: `${l.code}: ${reason}; excluded from totals`,
        });
      }
      return {
        code: l.code,
        description: l.description,
        category: l.category,
        unit: l.unit,
        status: 'unresolved',
        critical: l.critical,
        quantity:
          l.quantity === null
            ? null
            : triple((s) =>
                scenarioValue(l.quantity as ValueInput, s, `${l.code}.quantity`).toString(),
              ),
        unitRate:
          l.unitRate === null
            ? null
            : triple((s) =>
                scenarioValue(l.unitRate as ValueInput, s, `${l.code}.unitRate`).toString(),
              ),
        extended: null,
        sourceRevision: l.sourceRevision,
        formulaVersion: l.formulaVersion,
        confidence: l.confidence,
        formula: l.formula,
        unresolvedReason: reason,
      };
    }
    if (isBounded(l.quantity) || isBounded(l.unitRate)) bounded = true;
    const q = triple((s) => scenarioValue(l.quantity as ValueInput, s, `${l.code}.quantity`));
    const r = triple((s) => scenarioValue(l.unitRate as ValueInput, s, `${l.code}.unitRate`));
    for (const s of SCENARIOS) {
      if (q[s].isNegative() && !q[s].isZero())
        throw new PricingError('negative_value', `${l.code}: quantity must be >= 0`);
    }
    const ext = triple((s) =>
      money(logs[s].round('line_extension', l.code, q[s].times(r[s])), currency),
    );
    return {
      code: l.code,
      description: l.description,
      category: l.category,
      unit: l.unit,
      status: 'priced',
      critical: l.critical,
      quantity: triple((s) => q[s].toString()),
      unitRate: triple((s) => r[s].toString()),
      extended: ext,
      sourceRevision: l.sourceRevision,
      formulaVersion: l.formulaVersion,
      confidence: l.confidence,
      formula: l.formula,
      unresolvedReason: null,
    };
  });
  for (const sc of input.surcharges ?? []) if (isBounded(sc.rate)) bounded = true;

  const rangeDrivers = computeRangeDrivers(input);

  if (pending) {
    return {
      engineVersion: ENGINE_VERSION,
      trade: input.trade,
      recipe: input.recipe,
      policyRevision: policy.revision,
      currency,
      status: 'pending_review',
      firm: false,
      lines,
      scenarios: null,
      rangeDrivers,
      flags,
    };
  }

  const scenarios = triple((s) =>
    breakdown(s, lines, input, overheadRate, contingencyRate, logs[s], flags),
  );

  if (bounded) {
    flags.push({
      code: 'planning_range',
      message:
        'bounded assumptions remain: show the low/base/high planning range, withhold a firm total',
    });
    const threshold = policy.uncertaintyThreshold;
    const base = new PricingDecimal(scenarios.base.total.amount);
    if (threshold !== undefined && threshold !== null && base.gt(0)) {
      const width = new PricingDecimal(scenarios.high.total.amount)
        .minus(scenarios.low.total.amount)
        .div(base);
      if (width.gt(rate(threshold, 'uncertaintyThreshold'))) {
        flags.push({
          code: 'site_verification_required',
          message: `range width ${fmt(width.times(100), 1)}% exceeds policy threshold`,
        });
      }
    }
  }
  return {
    engineVersion: ENGINE_VERSION,
    trade: input.trade,
    recipe: input.recipe,
    policyRevision: policy.revision,
    currency,
    status: 'priced',
    firm: !bounded,
    lines,
    scenarios,
    rangeDrivers,
    flags: dedupeFlags(flags),
  };
}

function dedupeFlags(
  flags: { code: string; message: string }[],
): { code: string; message: string }[] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const k = `${f.code}:${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function breakdown(
  s: Scenario,
  lines: readonly PricedLine[],
  input: EstimateInput,
  overheadRate: PricingDecimal,
  contingencyRate: PricingDecimal,
  log: RoundingLog,
  flags: { code: string; message: string }[],
): Breakdown {
  const { policy } = input;
  const currency = policy.currency;
  const m = (d: PricingDecimal): Money => money(d, currency);
  const priced = lines.filter((l) => l.status === 'priced');
  const ext = (l: PricedLine): PricingDecimal =>
    new PricingDecimal((l.extended as Record<Scenario, Money>)[s].amount);

  // 2. Surcharges.
  const surcharges = (input.surcharges ?? []).map((sc) => {
    const r = scenarioValue(sc.rate, s, `${sc.code}.rate`);
    rate(r, `${sc.code}.rate`);
    const targets = priced.filter((l) => !sc.appliesTo || sc.appliesTo.includes(l.code));
    const base = targets.reduce((acc, l) => acc.plus(ext(l)), ZERO);
    return { code: sc.code, amount: log.round('surcharge', sc.code, base.times(r)) };
  });

  // 3-6. Direct, overhead, contingency, basis.
  const direct = priced
    .reduce((acc, l) => acc.plus(ext(l)), ZERO)
    .plus(surcharges.reduce((a, x) => a.plus(x.amount), ZERO));
  const overhead = log.round('overhead', 'overhead', direct.times(overheadRate));
  const contingency = log.round(
    'contingency',
    'contingency',
    direct.plus(overhead).times(contingencyRate),
  );
  const basis = direct.plus(overhead).plus(contingency);

  // 7. Price: markup OR target margin.
  let price: PricingDecimal;
  const p = policy.price;
  if (p.method === 'markup')
    price = log.round('price', 'markup', basis.times(ONE.plus(dec(p.markupRate))));
  else if (p.method === 'target_margin')
    price = log.round('price', 'target_margin', basis.div(ONE.minus(dec(p.marginRate))));
  else price = basis;

  // 8. Discounts in listed order.
  let running = price;
  const discounts = (policy.discounts ?? []).map((d) => {
    const raw =
      d.kind === 'percent'
        ? running.times(rate(d.value, `${d.code}.value`, 1))
        : dec(d.value, `${d.code}.value`);
    if (raw.isNegative())
      throw new PricingError('negative_value', `${d.code}: discount must be >= 0`);
    const amount = PricingDecimal.min(log.round('discount', d.code, raw), running);
    running = running.minus(amount);
    return { code: d.code, amount: m(amount), reason: d.reason };
  });

  // 9. Minimum charge.
  let minAdj = ZERO;
  if (policy.minimumCharge !== undefined && policy.minimumCharge !== null) {
    const min = log.round(
      'minimum_charge',
      'minimum_charge',
      dec(policy.minimumCharge, 'minimumCharge'),
    );
    if (running.lt(min)) {
      minAdj = min.minus(running);
      running = min;
      flags.push({
        code: 'minimum_charge_applied',
        message: 'pre-tax subtotal raised to the minimum job charge',
      });
    }
  }
  const subtotal = running;

  // 10. Tax.
  let tax = ZERO;
  const t = policy.tax;
  if (t) {
    const taxRate = rate(t.rate, 'tax.rate', 1);
    if (t.exemption) {
      flags.push({
        code: 'tax_exempt',
        message: `tax exempt: certificate ${t.exemption.certificateId}`,
      });
    } else {
      let taxable = subtotal;
      if (t.basis === 'taxable_share') {
        const all = priced.reduce((acc, l) => acc.plus(ext(l)), ZERO);
        const tx = priced
          .filter((l) => input.lines.find((x) => x.code === l.code)?.taxable !== false)
          .reduce((acc, l) => acc.plus(ext(l)), ZERO);
        taxable = all.isZero() ? ZERO : subtotal.times(tx).div(all);
      }
      tax = log.round('tax', t.jurisdiction ?? 'tax', taxable.times(taxRate));
    }
  }

  const grossMargin = subtotal.isZero() ? null : subtotal.minus(basis).div(subtotal);
  const markupOnCost = basis.isZero() ? null : subtotal.minus(basis).div(basis);
  if (policy.marginFloor !== undefined && policy.marginFloor !== null && grossMargin !== null) {
    if (grossMargin.lt(rate(policy.marginFloor, 'marginFloor', 1))) {
      flags.push({
        code: 'below_margin_floor',
        message: `realized gross margin ${fmt(grossMargin.times(100), 2)}% is below the floor; approval required`,
      });
    }
  }
  return {
    directCost: m(direct),
    surcharges: surcharges.map((x) => ({ code: x.code, amount: m(x.amount) })),
    overhead: m(overhead),
    contingency: m(contingency),
    costBasis: m(basis),
    priceBeforeDiscounts: m(price),
    discounts,
    minimumChargeAdjustment: m(minAdj),
    subtotal: m(subtotal),
    tax: m(tax),
    total: m(subtotal.plus(tax)),
    grossMargin: grossMargin === null ? null : fmt(grossMargin, 4),
    markupOnCost: markupOnCost === null ? null : fmt(markupOnCost, 4),
    rounding: [...log.records],
  };
}

/** One-at-a-time swings of each bounded input on direct cost (unrounded, then rounded for display). */
function computeRangeDrivers(input: EstimateInput): RangeDriver[] {
  const drivers: { d: RangeDriver; swing: PricingDecimal }[] = [];
  for (const l of input.lines) {
    if (l.quantity === null || l.unitRate === null) continue;
    for (const which of ['quantity', 'unitRate'] as const) {
      const v = l[which];
      if (!isBounded(v)) continue;
      const other = which === 'quantity' ? l.unitRate : l.quantity;
      const ob = scenarioValue(other, 'base', l.code);
      const swing = scenarioValue(v, 'high', l.code)
        .minus(scenarioValue(v, 'low', l.code))
        .times(ob);
      drivers.push({
        swing,
        d: {
          lineCode: l.code,
          input: which,
          reason: v.reason,
          directCostSwing: swing.toDecimalPlaces(2).toFixed(2),
        },
      });
    }
  }
  for (const sc of input.surcharges ?? []) {
    if (!isBounded(sc.rate)) continue;
    const base = input.lines
      .filter(
        (l) =>
          l.quantity !== null &&
          l.unitRate !== null &&
          (!sc.appliesTo || sc.appliesTo.includes(l.code)),
      )
      .reduce(
        (a, l) =>
          a.plus(
            scenarioValue(l.quantity as ValueInput, 'base', l.code).times(
              scenarioValue(l.unitRate as ValueInput, 'base', l.code),
            ),
          ),
        ZERO,
      );
    const swing = scenarioValue(sc.rate, 'high', sc.code)
      .minus(scenarioValue(sc.rate, 'low', sc.code))
      .times(base);
    drivers.push({
      swing,
      d: {
        lineCode: sc.code,
        input: 'surcharge',
        reason: sc.rate.reason,
        directCostSwing: swing.toDecimalPlaces(2).toFixed(2),
      },
    });
  }
  return drivers
    .sort((a, b) => b.swing.comparedTo(a.swing) || (a.d.lineCode < b.d.lineCode ? -1 : 1))
    .map((x) => x.d);
}
