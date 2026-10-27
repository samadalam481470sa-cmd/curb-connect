import { describe, expect, it } from 'vitest';
import {
  type CostLineInput,
  convertQuantity,
  dec,
  ENGINE_VERSION,
  type EstimateInput,
  money,
  moneyFromMinor,
  moneyToDecimal,
  nonNegative,
  type PricingPolicy,
  PricingDecimal,
  PricingError,
  priceEstimate,
  rate,
  roundMoney,
  scenarioValue,
  toJSONSafe,
  unitDimension,
  minorDigits,
  fmt,
} from './index';

const line = (
  code: string,
  quantity: CostLineInput['quantity'],
  unitRate: CostLineInput['unitRate'],
  extra: Partial<CostLineInput> = {},
): CostLineInput => ({
  code,
  description: code,
  category: 'fixed',
  quantity,
  unit: 'each',
  unitRate,
  critical: true,
  sourceRevision: 'book-rev-1',
  formulaVersion: 'test@1',
  confidence: 'high',
  formula: `${code}`,
  ...extra,
});

/** CP-060 synthetic calculator fixture: NOT a market quote. */
const PAGE60_LINES: CostLineInput[] = [
  line('cutting', '18', '20', { unit: 'ft' }),
  line('mobilization', '1', '400'),
  line('breakout', '18', '28', { unit: 'ft' }),
  line('disposal', '1', '220'),
  line('replacement', '18', '95', { unit: 'ft' }),
  line('traffic_control', '1', '350'),
  line('permit_allowance', '1', '200', { category: 'permit' }),
];

const policy = (p: Partial<PricingPolicy> = {}): PricingPolicy => ({
  currency: 'USD',
  overheadRate: '0.10',
  contingencyRate: '0',
  price: { method: 'target_margin', marginRate: '0.25' },
  revision: 'policy-1',
  ...p,
});

const est = (
  lines: CostLineInput[],
  p: Partial<PricingPolicy> = {},
  extra: Partial<EstimateInput> = {},
) => priceEstimate({ trade: 'curb', lines, policy: policy(p), recipe: 'test@1', ...extra });

describe('decimal and money foundation', () => {
  it('exact arithmetic and strict parsing', () => {
    expect(dec('0.1').plus('0.2').toString()).toBe('0.3');
    expect(dec(12.5).toString()).toBe('12.5');
    expect(dec(dec('3')).toString()).toBe('3');
    for (const bad of ['1e3', '12abc', '', 'NaN']) expect(() => dec(bad)).toThrow(PricingError);
    expect(() => dec(Number.NaN)).toThrow(/finite/);
    expect(() => dec(new PricingDecimal(Infinity))).toThrow(/finite/);
    expect(() => nonNegative('-1', 'x')).toThrow(/>= 0/);
    expect(nonNegative('-0', 'x').isZero()).toBe(true);
    expect(() => rate('11', 'r')).toThrow(/<= 10/);
  });
  it('rounds half-up at the minor unit (rounding boundaries)', () => {
    expect(roundMoney('2.345', 'USD').toFixed(2)).toBe('2.35');
    expect(roundMoney('2.344999', 'USD').toFixed(2)).toBe('2.34');
    expect(roundMoney('-2.345', 'USD').toFixed(2)).toBe('-2.35');
    expect(roundMoney('0.005', 'USD').toFixed(2)).toBe('0.01');
    expect(roundMoney('0.0049999', 'USD').toFixed(2)).toBe('0.00');
    expect(roundMoney('1234.5', 'JPY').toFixed(0)).toBe('1235');
    expect(minorDigits('JPY')).toBe(0);
    expect(() => minorDigits('XXX' as never)).toThrow(/unsupported/);
  });
  it('money in integer minor units', () => {
    const m = money('3744.00', 'USD');
    expect(m.minor).toBe(374400n);
    expect(m.amount).toBe('3744.00');
    expect(moneyFromMinor(549120n, 'USD').amount).toBe('5491.20');
    expect(moneyToDecimal(m).toString()).toBe('3744');
    expect(() => money('1.005', 'USD')).toThrow(/not rounded/);
    expect(toJSONSafe({ m })).toEqual({
      m: { currency: 'USD', minor: '374400', amount: '3744.00' },
    });
    expect(fmt(dec('1.23456'), 2)).toBe('1.23');
  });
  it('exact unit conversions', () => {
    expect(convertQuantity('10', 'ft', 'm').toString()).toBe('3.048');
    expect(convertQuantity('3.048', 'm', 'ft').toString()).toBe('10');
    expect(convertQuantity('27', 'ft3', 'yd3').toString()).toBe('1');
    expect(convertQuantity('1', 'yd2', 'ft2').toString()).toBe('9');
    expect(convertQuantity('1', 'square', 'ft2').toString()).toBe('100');
    expect(convertQuantity('144', 'in2', 'ft2').toString()).toBe('1');
    expect(convertQuantity('12', 'in', 'ft').toString()).toBe('1');
    expect(convertQuantity('5', 'm', 'm').toString()).toBe('5');
    expect(() => convertQuantity('1', 'ft', 'ft2')).toThrow(/cannot convert/);
    expect(() => unitDimension('furlong' as never)).toThrow(/unknown unit/);
  });
  it('bounded scenario values are ordered', () => {
    expect(scenarioValue({ low: 1, base: 2, high: 3, reason: 'r' }, 'high', 'x').toString()).toBe(
      '3',
    );
    expect(() => scenarioValue({ low: 3, base: 2, high: 1, reason: 'r' }, 'base', 'x')).toThrow(
      /low <= base/,
    );
  });
});

describe('CP-060 golden worked example', () => {
  const r = est(PAGE60_LINES);
  it('$3,744 direct, $4,118.40 after 10% overhead, $5,491.20 at 25% target margin, before tax', () => {
    expect(r.engineVersion).toBe(ENGINE_VERSION);
    expect(r.status).toBe('priced');
    expect(r.firm).toBe(true);
    const b = r.scenarios!.base;
    expect(b.directCost.amount).toBe('3744.00');
    expect(b.overhead.amount).toBe('374.40');
    expect(b.costBasis.amount).toBe('4118.40');
    expect(b.priceBeforeDiscounts.amount).toBe('5491.20');
    expect(b.subtotal.minor).toBe(549120n);
    expect(b.tax.amount).toBe('0.00');
    expect(b.total.amount).toBe('5491.20');
    expect(b.grossMargin).toBe('0.2500');
    expect(b.markupOnCost).toBe('0.3333');
    expect(r.lines.map((l) => [l.code, l.extended!.base.amount])).toEqual([
      ['cutting', '360.00'],
      ['mobilization', '400.00'],
      ['breakout', '504.00'],
      ['disposal', '220.00'],
      ['replacement', '1710.00'],
      ['traffic_control', '350.00'],
      ['permit_allowance', '200.00'],
    ]);
    expect(r.scenarios!.low).toEqual(r.scenarios!.high);
    expect(r.lines[0]).toMatchObject({
      sourceRevision: 'book-rev-1',
      formulaVersion: 'test@1',
      confidence: 'high',
      unit: 'ft',
    });
    expect(b.rounding.map((x) => x.stage)).toEqual([
      ...Array(7).fill('line_extension'),
      'overhead',
      'contingency',
      'price',
    ]);
  });
  it('identical input snapshots give identical results (CP-052 G)', () => {
    expect(toJSONSafe(est(PAGE60_LINES))).toEqual(toJSONSafe(r));
  });
});

describe('margin vs markup (CP-058 D)', () => {
  it('markup 25% on cost differs from 25% target margin', () => {
    const mk = est(PAGE60_LINES, { price: { method: 'markup', markupRate: '0.25' } }).scenarios!
      .base;
    expect(mk.total.amount).toBe('5148.00');
    expect(mk.grossMargin).toBe('0.2000');
    expect(mk.markupOnCost).toBe('0.2500');
    const none = est(PAGE60_LINES, { price: { method: 'cost_plus_none' } }).scenarios!.base;
    expect(none.total.amount).toBe('4118.40');
  });
  it('never both; margin must be < 1; unknown method rejected', () => {
    expect(() =>
      est(PAGE60_LINES, {
        price: { method: 'markup', markupRate: '0.2', marginRate: '0.2' } as never,
      }),
    ).toThrow(/EITHER markup OR/);
    expect(() =>
      est(PAGE60_LINES, { price: { method: 'target_margin', marginRate: '1' } }),
    ).toThrow(/< 1/);
    expect(() => est(PAGE60_LINES, { price: { method: 'bogus' } as never })).toThrow(
      /unknown price method/,
    );
  });
  it('contingency applies to direct + overhead', () => {
    const b = est(PAGE60_LINES, { contingencyRate: '0.05', price: { method: 'cost_plus_none' } })
      .scenarios!.base;
    expect(b.contingency.amount).toBe('205.92');
    expect(b.costBasis.amount).toBe('4324.32');
  });
});

describe('discounts, minimum charge, tax (BO-065 G)', () => {
  it('discount stack in listed order: percent of running amount, then fixed', () => {
    const b = est(PAGE60_LINES, {
      discounts: [
        { code: 'loyalty', kind: 'percent', value: '0.10', reason: 'repeat customer' },
        { code: 'promo', kind: 'amount', value: '100', reason: 'spring promo' },
      ],
    }).scenarios!.base;
    expect(b.discounts.map((d) => d.amount.amount)).toEqual(['549.12', '100.00']);
    expect(b.subtotal.amount).toBe('4842.08');
    const reversed = est(PAGE60_LINES, {
      discounts: [
        { code: 'promo', kind: 'amount', value: '100', reason: 'spring promo' },
        { code: 'loyalty', kind: 'percent', value: '0.10', reason: 'repeat customer' },
      ],
    }).scenarios!.base;
    expect(reversed.subtotal.amount).toBe('4852.08');
  });
  it('discount cannot go below zero, negative rejected, margin floor flagged', () => {
    const r = est(PAGE60_LINES, {
      discounts: [{ code: 'big', kind: 'amount', value: '99999', reason: 'x' }],
      marginFloor: '0.15',
    });
    expect(r.scenarios!.base.subtotal.amount).toBe('0.00');
    expect(r.scenarios!.base.grossMargin).toBeNull();
    const floor = est(PAGE60_LINES, {
      discounts: [{ code: 'd', kind: 'percent', value: '0.2', reason: 'x' }],
      marginFloor: '0.15',
    });
    expect(floor.flags.map((f) => f.code)).toContain('below_margin_floor');
    expect(() =>
      est(PAGE60_LINES, { discounts: [{ code: 'n', kind: 'amount', value: '-5', reason: 'x' }] }),
    ).toThrow(/>= 0/);
  });
  it('minimum trip charge raises small jobs only', () => {
    const small = est([line('cutting', '2', '20')], {
      minimumCharge: '450',
      price: { method: 'cost_plus_none' },
      overheadRate: '0',
    });
    expect(small.scenarios!.base.minimumChargeAdjustment.amount).toBe('410.00');
    expect(small.scenarios!.base.subtotal.amount).toBe('450.00');
    expect(small.flags.map((f) => f.code)).toContain('minimum_charge_applied');
    const big = est(PAGE60_LINES, { minimumCharge: '450' });
    expect(big.scenarios!.base.minimumChargeAdjustment.amount).toBe('0.00');
  });
  it('tax on subtotal, taxable share, and exemption', () => {
    const taxed = est(PAGE60_LINES, { tax: { rate: '0.0825', jurisdiction: 'TX-synthetic' } })
      .scenarios!.base;
    expect(taxed.tax.amount).toBe('453.02'); // 5491.20 x 0.0825 = 453.024
    expect(taxed.total.amount).toBe('5944.22');
    const lines = PAGE60_LINES.map((l) =>
      l.code === 'replacement' ? l : { ...l, taxable: false },
    );
    const share = est(lines, { tax: { rate: '0.10', basis: 'taxable_share' } }).scenarios!.base;
    // taxable share = 1710 / 3744 of 5491.20 = 2508.00; tax 250.80
    expect(share.tax.amount).toBe('250.80');
    const exempt = est(PAGE60_LINES, {
      tax: { rate: '0.0825', exemption: { certificateId: 'EX-1', reason: 'municipal' } },
    });
    expect(exempt.scenarios!.base.tax.amount).toBe('0.00');
    expect(exempt.flags.map((f) => f.code)).toContain('tax_exempt');
    const zeroLines = est([line('a', '0', '10')], {
      tax: { rate: '0.1', basis: 'taxable_share' },
      price: { method: 'cost_plus_none' },
    });
    expect(zeroLines.scenarios!.base.tax.amount).toBe('0.00');
  });
  it('line rounding boundary: 3 x 0.335 = 1.005 -> 1.01', () => {
    const r = est([line('a', '3', '0.335')], {
      overheadRate: '0',
      price: { method: 'cost_plus_none' },
    });
    expect(r.scenarios!.base.directCost.amount).toBe('1.01');
  });
});

describe('unknowns: pending review, never $0 (CP-052 S)', () => {
  it('critical unpriced component -> pending_review with no totals', () => {
    const r = est([...PAGE60_LINES, line('replacement_steel', '18', null)]);
    expect(r.status).toBe('pending_review');
    expect(r.scenarios).toBeNull();
    expect(r.firm).toBe(false);
    expect(r.lines.at(-1)).toMatchObject({ status: 'unresolved', extended: null, unitRate: null });
    expect(r.flags[0]!.code).toBe('unpriced_critical_component');
    const q = est([line('x', null, '5')]);
    expect(q.lines[0]!.unresolvedReason).toBe('quantity unknown');
    expect(q.lines[0]!.unitRate!.base).toBe('5');
  });
  it('optional unpriced line is excluded and flagged', () => {
    const r = est([...PAGE60_LINES, line('photo_log', '1', null, { critical: false })]);
    expect(r.status).toBe('priced');
    expect(r.scenarios!.base.directCost.amount).toBe('3744.00');
    expect(r.flags.map((f) => f.code)).toContain('unresolved_optional_line');
  });
  it('rejects duplicate codes and negative quantities', () => {
    expect(() => est([line('a', '1', '1'), line('a', '1', '1')])).toThrow(/duplicate/);
    expect(() => est([line('a', '-1', '1')])).toThrow(/>= 0/);
  });
});

describe('scenarios low/base/high (CP-058)', () => {
  const lines = [
    ...PAGE60_LINES.filter((l) => l.code !== 'disposal' && l.code !== 'permit_allowance'),
    line(
      'disposal',
      { low: '1', base: '1.5', high: '2.5', reason: 'buried depth unverified' },
      '220',
      { unit: 'load' },
    ),
    line('permit_allowance', '1', {
      low: '150',
      base: '200',
      high: '400',
      reason: 'municipal fee not confirmed',
    }),
  ];
  it('bounded assumptions produce a non-firm range and ranked drivers', () => {
    const r = est(lines, { uncertaintyThreshold: '0.05' });
    expect(r.firm).toBe(false);
    const s = r.scenarios!;
    expect(s.low.directCost.amount).toBe('3694.00');
    expect(s.base.directCost.amount).toBe('3854.00');
    expect(s.high.directCost.amount).toBe('4274.00');
    expect(r.rangeDrivers.map((d) => [d.lineCode, d.input, d.directCostSwing])).toEqual([
      ['disposal', 'quantity', '330.00'],
      ['permit_allowance', 'unitRate', '250.00'],
    ]);
    expect(r.flags.map((f) => f.code)).toEqual(['planning_range', 'site_verification_required']);
    const wide = est(lines, { uncertaintyThreshold: '0.5' });
    expect(wide.flags.map((f) => f.code)).toEqual(['planning_range']);
  });
  it('surcharges: complexity % on targeted lines, bounded surcharge is a driver', () => {
    const r = est(
      PAGE60_LINES,
      { price: { method: 'cost_plus_none' }, overheadRate: '0' },
      {
        surcharges: [
          {
            code: 'confined_access',
            description: 'confined',
            rate: { low: '0.10', base: '0.15', high: '0.20', reason: 'access unverified' },
            appliesTo: ['cutting', 'breakout'],
            sourceRevision: 'r1',
          },
        ],
      },
    );
    expect(r.scenarios!.base.surcharges[0]!.amount.amount).toBe('129.60');
    expect(r.scenarios!.base.directCost.amount).toBe('3873.60');
    expect(r.rangeDrivers[0]).toMatchObject({
      lineCode: 'confined_access',
      input: 'surcharge',
      directCostSwing: '86.40',
    });
    const all = est(
      PAGE60_LINES,
      { price: { method: 'cost_plus_none' }, overheadRate: '0' },
      {
        surcharges: [{ code: 'winter', description: 'w', rate: '0.10', sourceRevision: null }],
      },
    );
    expect(all.scenarios!.base.directCost.amount).toBe('4118.40');
    expect(all.firm).toBe(true);
  });
});
