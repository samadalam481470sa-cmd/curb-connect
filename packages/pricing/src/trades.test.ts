import { describe, expect, it } from 'vitest';
import {
  convertQuantity,
  curbCostLines,
  curbQuantities,
  type CurbQuantityInput,
  type CurbRecipe,
  dec,
  EXAMPLE_WASTE_RULES,
  materialTakeoff,
  type MaterialSpec,
  orderPacks,
  type PriceBookItem,
  priceEstimate,
  PricingDecimal,
  PricingError,
  recommendWaste,
  roofCostLines,
  roofTakeoff,
  type SawRateTable,
  sawCostLines,
  selectWaste,
  slopeFactor,
  tieredAmount,
  type WasteSelection,
} from './index';

const ft2m2 = (v: string) => convertQuantity(v, 'ft2', 'm2');
const ftm = (v: string) => convertQuantity(v, 'ft', 'm');

describe('roof takeoff (RF-027, RF-029)', () => {
  it('0/12, 6/12, 12/12 slope factors and sloped areas', () => {
    expect(slopeFactor({ rise: 0, run: 12 }).toString()).toBe('1');
    expect(slopeFactor({ rise: 6, run: 12 }).toString()).toBe(
      new PricingDecimal('1.25').sqrt().toString(),
    );
    expect(slopeFactor({ rise: 12, run: 12 }).toFixed(12)).toBe('1.414213562373');
    expect(() => slopeFactor({ rise: 1, run: 0 })).toThrow(/run must be > 0/);
    const t = roofTakeoff({
      facets: [
        { id: 'flat', structureId: 'house', planAreaM2: ft2m2('100'), pitch: { rise: 0, run: 12 } },
        { id: 'six', structureId: 'house', planAreaM2: ft2m2('100'), pitch: { rise: 6, run: 12 } },
        {
          id: 'twelve',
          structureId: 'garage',
          planAreaM2: ft2m2('100'),
          pitch: { rise: 12, run: 12 },
        },
      ],
      edgeLengthsM: {},
    });
    expect(dec(t.facets[0]!.slopedFt2!).toString()).toBe('100');
    expect(dec(t.facets[0]!.squares!).toString()).toBe('1');
    expect(dec(t.facets[1]!.slopedFt2!).toFixed(6)).toBe('111.803399');
    expect(dec(t.facets[2]!.slopedFt2!).toFixed(6)).toBe('141.421356');
    expect(dec(t.structures.house!.slopedFt2!).toFixed(6)).toBe('211.803399');
    expect(dec(t.property.squares!).toFixed(6)).toBe('3.532248');
  });
  it('mixed pitch six-facet hip fixture and structure exclusion', () => {
    const t = roofTakeoff({
      facets: [
        ...[300, 100, 200, 200, 100, 300].map((a, i) => ({
          id: `f${i}`,
          structureId: 'house',
          planAreaM2: ft2m2(String(a)),
          pitch: { rise: 6, run: 12 },
        })),
        { id: 'shed', structureId: 'shed', planAreaM2: ft2m2('80'), pitch: null },
      ],
      edgeLengthsM: { eave: ftm('160'), ridge: ftm('40'), hip: ftm('75'), valley: ftm('15') },
      excludedStructureIds: ['shed'],
    });
    expect(dec(t.structures.house!.planM2).eq(ft2m2('1200'))).toBe(true);
    expect(dec(t.property.slopedFt2!).toFixed(4)).toBe('1341.6408');
    expect(t.structures.shed!.slopedFt2).toBeNull();
    expect(t.facets.at(-1)!.included).toBe(false);
    expect(t.edgeLf.hip!.toString()).toBe('75');
    expect(t.edgeLf.rake!.toString()).toBe('0');
    expect(() =>
      roofTakeoff({ facets: [t.facets[0] as never, t.facets[0] as never], edgeLengthsM: {} }),
    ).toThrow();
    const unknown = roofTakeoff({
      facets: [{ id: 'a', structureId: 's', planAreaM2: '1', pitch: null }],
      edgeLengthsM: { eave: null },
    });
    expect(unknown.slopedFt2).toBeNull();
    expect(unknown.edgeLf.eave).toBeNull();
    expect(() =>
      roofTakeoff({
        facets: [
          { id: 'a', structureId: 's', planAreaM2: '1', pitch: null },
          { id: 'a', structureId: 's', planAreaM2: '1', pitch: null },
        ],
        edgeLengthsM: {},
      }),
    ).toThrow(/duplicate/);
  });
});

describe('waste recommendation and selection (RR-035)', () => {
  const base = {
    roofType: 'hip',
    facetCount: 6,
    hipCount: 5,
    valleyCount: 1,
    maxPitchRatio: '0.5',
  };
  it('first matching rule wins with reason codes and rule version', () => {
    expect(recommendWaste(base, EXAMPLE_WASTE_RULES)).toMatchObject({
      status: 'recommended',
      wasteRate: '0.12',
      ruleId: 'hip',
      reasonCodes: ['HIP_CUTS'],
    });
    expect(recommendWaste({ ...base, valleyCount: 4 }, EXAMPLE_WASTE_RULES)).toMatchObject({
      wasteRate: '0.17',
    });
    expect(recommendWaste({ ...base, facetCount: 14 }, EXAMPLE_WASTE_RULES)).toMatchObject({
      ruleId: 'complex-cut-up-facets',
    });
    expect(recommendWaste({ ...base, maxPitchRatio: '1' }, EXAMPLE_WASTE_RULES)).toMatchObject({
      wasteRate: '0.15',
    });
    expect(
      recommendWaste({ ...base, roofType: 'gable', hipCount: 0 }, EXAMPLE_WASTE_RULES),
    ).toMatchObject({ wasteRate: '0.1' });
  });
  it('no recommendation => human value required', () => {
    expect(recommendWaste({ ...base, roofType: 'mansard' }, EXAMPLE_WASTE_RULES)).toMatchObject({
      status: 'none',
      reason: 'outside_applicability',
      requireHumanValue: true,
    });
    expect(
      recommendWaste({ ...base, roofType: 'combination', hipCount: 0 }, EXAMPLE_WASTE_RULES),
    ).toMatchObject({ reason: 'no_rule_matched' });
    expect(recommendWaste({ ...base, maxPitchRatio: '2' }, EXAMPLE_WASTE_RULES).status).toBe(
      'none',
    );
    expect(recommendWaste({ ...base, facetCount: 41 }, EXAMPLE_WASTE_RULES).status).toBe('none');
    const custom = {
      ...EXAMPLE_WASTE_RULES,
      rules: [{ id: 'few', reasonCode: 'FEW', wasteRate: '0.05', when: { maxFacets: 4 } }],
    };
    expect(recommendWaste({ ...base, facetCount: 3 }, custom).status).toBe('recommended');
    expect(
      selectWaste({
        recommendation: recommendWaste({ ...base, roofType: 'mansard' }, EXAMPLE_WASTE_RULES),
      }).status,
    ).toBe('unresolved');
  });
  it('override wins but keeps the previous recommendation', () => {
    const rec = recommendWaste(base, EXAMPLE_WASTE_RULES);
    const sel = selectWaste({
      recommendation: rec,
      override: { wasteRate: '0.14', reason: 'steep cut-up dormers', by: 'estimator-1' },
    });
    expect(sel).toMatchObject({ status: 'selected', source: 'override', recommendedRate: '0.12' });
    expect(selectWaste({ recommendation: rec })).toMatchObject({
      source: 'recommendation',
      reason: 'HIP_CUTS',
    });
    expect(
      selectWaste({
        recommendation: null,
        override: { wasteRate: '0', reason: 'metal panels cut to length', by: 'x' },
      }),
    ).toMatchObject({ recommendedRate: null });
    expect(() =>
      selectWaste({ recommendation: rec, override: { wasteRate: '0.1', reason: ' ', by: 'x' } }),
    ).toThrow(PricingError);
  });
});

const SPECS: MaterialSpec[] = [
  {
    code: 'shingles',
    description: 'Architectural shingles',
    materialClass: 'shingles',
    basis: { kind: 'sloped_area' },
    coveragePerPack: '33.3333333333333333333',
    packUnit: 'bundle',
    sku: 'SYN-SH-1',
    unitPrice: '42.50',
    priceSourceRevision: 'cat-1',
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
    priceSourceRevision: 'cat-1',
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
    priceSourceRevision: 'cat-1',
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
    priceSourceRevision: 'cat-1',
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
    priceSourceRevision: 'cat-1',
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
    priceSourceRevision: 'cat-1',
    critical: false,
  },
  {
    code: 'flashing',
    description: 'Step flashing',
    materialClass: 'flashing',
    basis: { kind: 'edges', edgeTypes: ['flashing', 'step_flashing'] },
    coveragePerPack: null,
    packUnit: 'box',
    unitPrice: null,
    priceSourceRevision: null,
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
    priceSourceRevision: 'cat-1',
    critical: false,
  },
];

function hipTakeoff() {
  return roofTakeoff({
    facets: [
      { id: 'all', structureId: 'house', planAreaM2: ft2m2('1200'), pitch: { rise: 6, run: 12 } },
    ],
    edgeLengthsM: { eave: ftm('160'), ridge: ftm('40'), hip: ftm('75'), valley: ftm('15') },
  });
}
const sel = (w: string): WasteSelection =>
  selectWaste({ recommendation: null, override: { wasteRate: w, reason: 'test', by: 't' } });
const allWaste = (w: string) => ({
  shingles: sel(w),
  underlayment: sel('0'),
  starter: sel('0'),
  ridge_cap: sel(w),
  drip_edge: sel('0'),
  valley: sel('0'),
  flashing: sel('0'),
});

describe('material takeoff (RR-034, RF-029 G)', () => {
  it('0%, ordinary and high waste are applied once, never compounded', () => {
    for (const [w, packs] of [
      ['0', '40.249223594996'],
      ['0.10', '44.274145954496'],
      ['0.17', '47.091591606146'],
    ] as const) {
      const lines = materialTakeoff(hipTakeoff(), SPECS, allWaste(w));
      const sh = lines[0]!;
      expect(dec(sh.quantityWithWaste!).eq(dec(sh.baseQuantity!).times(dec(1).plus(w)))).toBe(true);
      expect(dec(sh.exactPacks!).toFixed(12)).toBe(packs);
      // Underlayment base is the SAME sloped area: shingle waste does not leak into other classes.
      expect(lines[1]!.baseQuantity).toBe(sh.baseQuantity);
      expect(lines[1]!.wasteRate).toBe('0');
    }
    const ten = materialTakeoff(hipTakeoff(), SPECS, allWaste('0.10'));
    expect(ten.map((l) => [l.code, l.orderPacks])).toEqual([
      ['shingles', '45'],
      ['underlayment', '2'],
      ['starter', '2'],
      ['ridge_cap', '6'],
      ['drip_edge', '16'],
      ['valley', '2'],
      ['flashing', null],
      ['vents', '4'],
    ]);
    expect(ten[0]!.formula).toMatch(
      /1341\.6408 ft2 \(sloped roof area\) x \(1 \+ 10\.00% waste\) = 1475\.8049 ft2 .* -> order 45 bundle/,
    );
    expect(ten[6]).toMatchObject({
      status: 'unresolved',
      unresolvedReason: expect.stringMatching(/coverage per pack unknown/),
    });
    expect(dec(ten[3]!.exactPacks!).toString()).toBe('5.06'); // (40+75) x 1.10 / 25
  });
  it('pack rounding: exact integers stay, fractions round up, sqrt noise absorbed', () => {
    expect(orderPacks(dec('30')).toString()).toBe('30');
    expect(orderPacks(dec('30.0000000000001')).toString()).toBe('30');
    expect(orderPacks(dec('30.000001')).toString()).toBe('31');
    expect(orderPacks(dec('29.9999999999')).toString()).toBe('30');
    expect(orderPacks(dec('0')).toString()).toBe('0');
    const flat = roofTakeoff({
      facets: [
        { id: 'f', structureId: 'h', planAreaM2: ft2m2('1000'), pitch: { rise: 0, run: 12 } },
      ],
      edgeLengthsM: {},
    });
    const l = materialTakeoff(flat, [SPECS[0]!], { shingles: sel('0.10') })[0]!;
    expect(dec(l.exactPacks!).toFixed(9)).toBe('33.000000000');
    expect(l.orderPacks).toBe('33');
  });
  it('unresolved when area, edges or waste unknown; invalid coverage throws', () => {
    const unknown = roofTakeoff({
      facets: [{ id: 'f', structureId: 'h', planAreaM2: '10', pitch: null }],
      edgeLengthsM: { eave: null },
    });
    const lines = materialTakeoff(unknown, SPECS, allWaste('0.1'));
    expect(lines[0]!.unresolvedReason).toMatch(/sloped roof area unknown/);
    expect(lines[2]!.unresolvedReason).toMatch(/eave \+ rake unknown/);
    expect(materialTakeoff(hipTakeoff(), [SPECS[0]!], {})[0]!.unresolvedReason).toMatch(
      /waste for shingles not selected/,
    );
    expect(
      materialTakeoff(
        hipTakeoff(),
        [{ ...SPECS[7]!, basis: { kind: 'count', count: null } }],
        {},
      )[0]!.status,
    ).toBe('unresolved');
    expect(() =>
      materialTakeoff(hipTakeoff(), [{ ...SPECS[0]!, coveragePerPack: '0' }], allWaste('0')),
    ).toThrow(/coverage must be > 0/);
  });
  it('roof recipe priced by the shared engine', () => {
    const t = hipTakeoff();
    const mats = materialTakeoff(t, SPECS, allWaste('0.10'));
    const lines = roofCostLines(t, mats, SPECS, [
      {
        code: 'install_labor',
        description: 'Tear-off and install',
        ratePerSquare: '95',
        sourceRevision: 'labor-1',
      },
    ]);
    const r = priceEstimate({
      trade: 'roof',
      lines,
      recipe: 'roof.standard@1',
      policy: {
        currency: 'USD',
        overheadRate: '0.10',
        price: { method: 'markup', markupRate: '0.30' },
        revision: 'p1',
      },
    });
    expect(r.status).toBe('priced');
    // 45x42.50 + 2x150 + 2x60 + 6x70 + 16x12 + 2x25 + 4x18 = 3066.50; labor 13.416407865 sq x 95 = 1274.56
    expect(r.scenarios!.base.directCost.amount).toBe('4341.06');
    expect(r.flags.map((f) => f.code)).toEqual(['unresolved_optional_line']);
    expect(() => roofCostLines(t, mats, [])).toThrow(/no spec/);
    const pending = roofCostLines(
      roofTakeoff({
        facets: [{ id: 'f', structureId: 'h', planAreaM2: '10', pitch: null }],
        edgeLengthsM: {},
      }),
      [],
      [],
      [{ code: 'labor', description: 'l', ratePerSquare: '95', sourceRevision: null }],
    );
    expect(
      priceEstimate({
        trade: 'roof',
        lines: pending,
        recipe: 'r',
        policy: { currency: 'USD', price: { method: 'cost_plus_none' }, revision: 'p' },
      }).status,
    ).toBe('pending_review');
  });
});

const curbInput = (
  lengthFt: string,
  extra: Partial<CurbQuantityInput> = {},
): CurbQuantityInput => ({
  segments: [{ id: 's1', kind: 'straight', length: lengthFt, unit: 'ft' }],
  sawPasses: 2,
  cutDepth: { state: 'known', value: '6', unit: 'in' },
  removalWidth: { state: 'known', value: '2', unit: 'ft' },
  crossSection: { state: 'known', value: '1.5', unit: 'ft2' },
  restorationLength: { state: 'known', value: lengthFt, unit: 'ft' },
  restorationWidth: { state: 'known', value: '2', unit: 'ft' },
  ...extra,
});

describe('curb quantities (CP-051 G)', () => {
  it('10-ft case', () => {
    const q = curbQuantities(curbInput('10'));
    expect(q.cutLengthFt).toMatchObject({ state: 'known' });
    const v = (x: (typeof q)['cutLengthFt']) =>
      x.state === 'known' ? x.value.toString() : x.state;
    expect(v(q.cutLengthFt)).toBe('10');
    expect(v(q.sawPassLengthFt)).toBe('20');
    expect(v(q.inchFeet)).toBe('120');
    expect(v(q.removalAreaFt2)).toBe('20');
    expect(v(q.removalVolumeFt3)).toBe('15');
    expect(dec(v(q.removalVolumeYd3)).toFixed(6)).toBe('0.555556');
    expect(v(q.restorationAreaFt2)).toBe('20');
    expect(q.issues).toEqual([]);
  });
  it('25-ft case and unit switch (meters / inches give identical quantities)', () => {
    const imperial = curbQuantities(curbInput('25'));
    const metric = curbQuantities({
      ...curbInput('25'),
      segments: [{ id: 's1', kind: 'straight', length: '7.62' }],
      cutDepth: { state: 'known', value: '15.24', unit: 'cm' },
      removalWidth: { state: 'known', value: '24', unit: 'in' },
      crossSection: { state: 'known', value: '216', unit: 'in2' },
    });
    for (const k of [
      'cutLengthFt',
      'sawPassLengthFt',
      'inchFeet',
      'removalAreaFt2',
      'removalVolumeYd3',
    ] as const) {
      const a = imperial[k];
      const b = metric[k];
      expect(a.state === 'known' && b.state === 'known' && a.value.eq(b.value), k).toBe(true);
    }
    const vol = imperial.removalVolumeYd3;
    expect(vol.state === 'known' && vol.value.toFixed(6)).toBe('1.388889');
  });
  it('zero depth is an issue and saw quantities become unknown', () => {
    const q = curbQuantities(
      curbInput('10', { cutDepth: { state: 'known', value: '0', unit: 'in' } }),
    );
    expect(q.issues.map((i) => i.code)).toEqual(['zero_depth']);
    expect(q.inchFeet.state).toBe('unknown');
    expect(q.sawPassLengthFt.state).toBe('known');
    const zl = curbQuantities({
      ...curbInput('0'),
      restorationLength: { state: 'known', value: '0', unit: 'ft' },
    });
    expect(zl.issues.map((i) => i.code)).toEqual(['zero_length']);
  });
  it('corner geometry sums both legs as separate segments', () => {
    const q = curbQuantities({
      ...curbInput('18'),
      segments: [
        { id: 'a', kind: 'corner', length: '10', unit: 'ft' },
        { id: 'b', kind: 'corner', length: '8', unit: 'ft' },
      ],
    });
    expect(q.segmentCount).toBe(2);
    expect(q.cutLengthFt.state === 'known' && q.cutLengthFt.value.toString()).toBe('18');
  });
  it('unknown buried section => unknown volume; bounded => scenario bounds', () => {
    const unk = curbQuantities(
      curbInput('10', {
        crossSection: { state: 'unknown', reason: 'buried depth not verified' },
        restorationWidth: undefined as never,
      }),
    );
    expect(unk.removalVolumeYd3).toMatchObject({
      state: 'unknown',
      reason: 'crossSection: buried depth not verified',
    });
    const noWidth = curbQuantities({ ...curbInput('10'), restorationWidth: undefined });
    expect(noWidth.restorationAreaFt2.state).toBe('unknown');
    const b = curbQuantities(
      curbInput('10', {
        crossSection: {
          state: 'bounded',
          low: '1',
          base: '1.5',
          high: '2',
          unit: 'ft2',
          reason: 'profile 6-9 in buried',
        },
        cutDepth: {
          state: 'bounded',
          low: '6',
          base: '7',
          high: '9',
          unit: 'in',
          reason: 'depth unverified',
        },
      }),
    );
    expect(b.removalVolumeFt3).toMatchObject({
      state: 'bounded',
      reason: 'crossSection: profile 6-9 in buried',
    });
    const v = b.removalVolumeFt3;
    if (v.state !== 'bounded') throw new Error();
    expect([v.low.toString(), v.base.toString(), v.high.toString()]).toEqual(['10', '15', '20']);
    expect(b.inchFeet.state).toBe('bounded');
    expect(() =>
      curbQuantities(
        curbInput('10', {
          cutDepth: { state: 'bounded', low: '9', base: '7', high: '6', unit: 'in', reason: 'x' },
        }),
      ),
    ).toThrow(/low <= base/);
    expect(() => curbQuantities({ ...curbInput('10'), sawPasses: 0 })).toThrow(/sawPasses/);
    expect(() => curbQuantities({ ...curbInput('10'), segments: [] })).toThrow(/segment/);
    const removal = curbQuantities({
      ...curbInput('10'),
      removalLength: { state: 'known', value: '4', unit: 'ft' },
    });
    expect(
      removal.removalAreaFt2.state === 'known' && removal.removalAreaFt2.value.toString(),
    ).toBe('8');
  });
});

const BOOK: PriceBookItem[] = [
  { code: 'saw_lf', unit: 'ft', rate: '20', revision: 'synthetic-book-2026.1' },
  { code: 'mob', unit: 'each', rate: '400', revision: 'synthetic-book-2026.1' },
  { code: 'breakout_lf', unit: 'ft', rate: '28', revision: 'synthetic-book-2026.1' },
  { code: 'disposal_load', unit: 'each', rate: '220', revision: 'synthetic-book-2026.1' },
  { code: 'replace_lf', unit: 'ft', rate: '95', revision: 'synthetic-book-2026.1' },
  { code: 'traffic', unit: 'each', rate: '350', revision: 'synthetic-book-2026.1' },
  { code: 'permit', unit: 'each', rate: '200', revision: 'synthetic-book-2026.1' },
  { code: 'steel', unit: 'ft', rate: null, revision: 'synthetic-book-2026.1' },
];

const PAGE60_RECIPE: CurbRecipe = {
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

describe('curb recipe -> engine (CP-052, CP-060)', () => {
  it('page-60 example from measured quantities: $3,744 / $4,118.40 / $5,491.20', () => {
    const q = curbQuantities(curbInput('18'));
    const lines = curbCostLines(q, PAGE60_RECIPE, BOOK);
    expect(lines[0]!.formula).toBe(
      'cutting: 18.0000 ft (sum of 1 piecewise segment lengths = 18.0000 ft) x 20 per ft',
    );
    expect(lines[0]!.sourceRevision).toBe('synthetic-book-2026.1');
    const r = priceEstimate({
      trade: 'curb',
      lines,
      recipe: 'driveway-opening@1.0.0',
      policy: {
        currency: 'USD',
        overheadRate: '0.10',
        price: { method: 'target_margin', marginRate: '0.25' },
        revision: 'p',
      },
    });
    expect(r.scenarios!.base.directCost.amount).toBe('3744.00');
    expect(r.scenarios!.base.costBasis.amount).toBe('4118.40');
    expect(r.scenarios!.base.total.amount).toBe('5491.20');
  });
  it('missing catalog price for a critical component => pending review', () => {
    const recipe = {
      ...PAGE60_RECIPE,
      components: [
        ...PAGE60_RECIPE.components,
        {
          code: 'rebar',
          description: 'Dowels',
          category: 'material' as const,
          basis: 'cut_length_ft' as const,
          priceItem: 'steel',
          critical: true,
        },
        {
          code: 'nothing',
          description: 'n',
          category: 'material' as const,
          basis: 'removal_volume_yd3' as const,
          priceItem: 'absent',
          critical: false,
        },
      ],
    };
    const lines = curbCostLines(curbQuantities(curbInput('18')), recipe, BOOK);
    expect(lines.at(-2)!.unresolvedReason).toBe('no approved rate for steel');
    expect(lines.at(-1)!.sourceRevision).toBeNull();
    const r = priceEstimate({
      trade: 'curb',
      lines,
      recipe: 'x',
      policy: { currency: 'USD', price: { method: 'cost_plus_none' }, revision: 'p' },
    });
    expect(r.status).toBe('pending_review');
    expect(r.scenarios).toBeNull();
  });
  it('unknown buried volume in a volume-priced disposal line => pending, not $0', () => {
    const recipe: CurbRecipe = {
      id: 'v',
      version: '1',
      components: [
        {
          code: 'disposal',
          description: 'd',
          category: 'disposal',
          basis: 'removal_volume_yd3',
          priceItem: 'disposal_load',
          critical: true,
        },
      ],
    };
    const q = curbQuantities(
      curbInput('10', { crossSection: { state: 'unknown', reason: 'buried' } }),
    );
    const lines = curbCostLines(q, recipe, BOOK);
    expect(lines[0]).toMatchObject({
      quantity: null,
      unresolvedReason: 'crossSection: buried',
      confidence: 'low',
    });
    const bounded = curbCostLines(
      curbQuantities(
        curbInput('10', {
          crossSection: {
            state: 'bounded',
            low: '1',
            base: '1.5',
            high: '2',
            unit: 'ft2',
            reason: 'r',
          },
        }),
      ),
      recipe,
      BOOK,
    );
    expect(bounded[0]!.formula).toMatch(/0\.3704-0\.7407 yd3/);
    const all: CurbRecipe = {
      id: 'a',
      version: '1',
      components: (
        [
          'saw_pass_length_ft',
          'inch_feet',
          'removal_area_ft2',
          'restoration_area_ft2',
          'segment_count',
        ] as const
      ).map((b) => ({
        code: b,
        description: b,
        category: 'labor' as const,
        basis: b,
        priceItem: 'mob',
        critical: false,
      })),
    };
    expect(
      curbCostLines(curbQuantities(curbInput('10')), all, BOOK).map((l) => l.quantity?.toString()),
    ).toEqual(['20', '120', '20', '20', '1']);
    expect(() =>
      curbCostLines(
        curbQuantities(curbInput('10')),
        { id: 'x', version: '1', components: [{ ...all.components[0]!, basis: 'bogus' as never }] },
        BOOK,
      ),
    ).toThrow(/unknown basis/);
  });
  it('tiered length pricing is graduated', () => {
    const tiers = [
      { upTo: '20', rate: '20' },
      { upTo: '100', rate: '15' },
      { upTo: null, rate: '12' },
    ];
    expect(tieredAmount(dec('18'), tiers).toString()).toBe('360');
    expect(tieredAmount(dec('20'), tiers).toString()).toBe('400');
    expect(tieredAmount(dec('25'), tiers).toString()).toBe('475');
    expect(tieredAmount(dec('150'), tiers).toString()).toBe('2200');
    expect(() => tieredAmount(dec('150'), [{ upTo: '20', rate: '1' }])).toThrow(/unbounded/);
    expect(() =>
      tieredAmount(dec('5'), [
        { upTo: '20', rate: '1' },
        { upTo: '10', rate: '1' },
        { upTo: null, rate: '1' },
      ]),
    ).toThrow(/increasing/);
    const recipe: CurbRecipe = {
      id: 't',
      version: '1',
      components: [
        {
          code: 'cutting',
          description: 'c',
          category: 'labor',
          basis: 'cut_length_ft',
          priceItem: 'saw_lf',
          critical: true,
          tiers,
        },
      ],
    };
    const lines = curbCostLines(curbQuantities(curbInput('25')), recipe, BOOK);
    const r = priceEstimate({
      trade: 'curb',
      lines,
      recipe: 't',
      policy: { currency: 'USD', price: { method: 'cost_plus_none' }, revision: 'p' },
    });
    expect(r.scenarios!.base.directCost.amount).toBe('475.00');
    expect(lines[0]!.formula).toMatch(/graduated/);
    const zero = curbCostLines(
      curbQuantities({
        ...curbInput('0'),
        restorationLength: { state: 'known', value: '0', unit: 'ft' },
      }),
      recipe,
      BOOK,
    );
    expect(zero[0]!.unitRate!.toString()).toBe('20');
  });
});

const SAW: SawRateTable = {
  revision: 'saw-rates-synthetic-1',
  region: 'synthetic-metro',
  effectiveDate: '2026-01-01',
  source: 'internal synthetic',
  setupHoursPerSegment: '0.5',
  hourlyRate: '180',
  bladeCostPerInchFoot: '0.10',
  rules: [
    {
      id: 'shallow-open-none',
      maxDepthIn: '4',
      reinforcement: 'none',
      access: 'open',
      feetPerHour: '60',
    },
    {
      id: 'deep-open-none',
      maxDepthIn: '8',
      reinforcement: 'none',
      access: 'open',
      feetPerHour: '30',
    },
    {
      id: 'deep-open-rebar',
      maxDepthIn: '8',
      reinforcement: 'rebar',
      access: 'open',
      feetPerHour: '15',
    },
    {
      id: 'deep-open-mesh',
      maxDepthIn: '8',
      reinforcement: 'mesh',
      access: 'open',
      feetPerHour: '24',
    },
    {
      id: 'deep-confined-none',
      maxDepthIn: '8',
      reinforcement: 'none',
      access: 'confined',
      feetPerHour: '18',
    },
  ],
};

describe('saw production (CP-053)', () => {
  const pass = (ft: string) => ({
    state: 'known' as const,
    value: dec(ft),
    unit: 'ft',
    formula: 'f',
  });
  const depth = (inch: string) => ({
    state: 'known' as const,
    value: dec(inch),
    unit: 'in',
    formula: 'd',
  });
  it('setup time is separate from productive time', () => {
    const lines = sawCostLines(
      {
        passLengthFt: pass('36'),
        depthIn: depth('4'),
        reinforcement: 'none',
        access: 'open',
        segmentCount: 2,
      },
      SAW,
    );
    expect(lines.map((l) => [l.code, l.quantity?.toString()])).toEqual([
      ['saw_setup', '1'],
      ['saw_productive', '0.6'],
      ['saw_blade_wear', '144'],
    ]);
  });
  it('equal feet, different depth and access => distinct allowances', () => {
    const cost = (d: string, access: 'open' | 'confined') => {
      const lines = sawCostLines(
        {
          passLengthFt: pass('36'),
          depthIn: depth(d),
          reinforcement: 'none',
          access,
          segmentCount: 1,
        },
        SAW,
      );
      return priceEstimate({
        trade: 'curb',
        lines,
        recipe: 'saw',
        policy: { currency: 'USD', price: { method: 'cost_plus_none' }, revision: 'p' },
      }).scenarios!.base.directCost.amount;
    };
    expect(cost('4', 'open')).toBe('212.40'); // 90 setup + 108 cut + 14.40 blade
    expect(cost('6', 'open')).toBe('327.60'); // 90 + 216 + 21.60
    expect(cost('6', 'confined')).toBe('471.60'); // 90 + 360 + 21.60
  });
  it('unknown depth or reinforcement => uncertain range, low confidence', () => {
    const lines = sawCostLines(
      {
        passLengthFt: pass('36'),
        depthIn: depth('6'),
        reinforcement: 'unknown',
        access: 'open',
        segmentCount: 1,
      },
      SAW,
    );
    const prod = lines[1]!;
    expect(prod.confidence).toBe('low');
    expect(prod.quantity).toMatchObject({ low: dec('1.2'), high: dec('2.4') });
    const unkDepth = sawCostLines(
      {
        passLengthFt: pass('36'),
        depthIn: { state: 'unknown', unit: 'in', reason: 'r', formula: 'f' },
        reinforcement: 'none',
        access: 'open',
        segmentCount: 1,
      },
      SAW,
    );
    expect(unkDepth[1]!.quantity).toMatchObject({ low: dec('0.6'), high: dec('1.2') });
    expect(unkDepth[2]).toMatchObject({ quantity: null, unresolvedReason: 'cut depth unknown' });
    const r = priceEstimate({
      trade: 'curb',
      lines: unkDepth,
      recipe: 'saw',
      policy: { currency: 'USD', price: { method: 'cost_plus_none' }, revision: 'p' },
    });
    expect(r.firm).toBe(false);
    expect(r.rangeDrivers[0]!.reason).toMatch(/saw productivity uncertain/);
    const boundedDepth = sawCostLines(
      {
        passLengthFt: {
          state: 'bounded',
          low: dec('30'),
          base: dec('36'),
          high: dec('40'),
          unit: 'ft',
          formula: 'f',
          reason: 'len',
        },
        depthIn: {
          state: 'bounded',
          low: dec('4'),
          base: dec('6'),
          high: dec('8'),
          unit: 'in',
          formula: 'f',
          reason: 'depth',
        },
        reinforcement: 'none',
        access: 'open',
        segmentCount: 1,
      },
      SAW,
    );
    expect(boundedDepth[2]!.quantity).toMatchObject({
      low: dec('120'),
      base: dec('216'),
      high: dec('320'),
    });
  });
  it('no matching rule or unknown pass length => unresolved productive line', () => {
    const none = sawCostLines(
      {
        passLengthFt: pass('36'),
        depthIn: depth('12'),
        reinforcement: 'none',
        access: 'open',
        segmentCount: 1,
      },
      SAW,
    );
    expect(none[1]).toMatchObject({
      quantity: null,
      unresolvedReason: 'no production rate for this depth/reinforcement/access',
    });
    const unk = sawCostLines(
      {
        passLengthFt: { state: 'unknown', unit: 'ft', reason: 'r', formula: 'f' },
        depthIn: depth('4'),
        reinforcement: 'none',
        access: 'open',
        segmentCount: 1,
      },
      SAW,
    );
    expect(unk[1]!.unresolvedReason).toBe('saw pass length unknown');
  });
});
