import { convertQuantity, dec } from '@fieldline/pricing';
import { describe, expect, it } from 'vitest';
import { computeRoofEstimate } from './calc';
import { EXAMPLE_LABOR, EXAMPLE_MATERIAL_SPECS } from './defaults';

describe('computeRoofEstimate', () => {
  it('matches the hip takeoff material + labor fixture from pricing trades tests', () => {
    const result = computeRoofEstimate({
      facets: [
        {
          id: 'all',
          structureId: 'house',
          planArea: '1200',
          planAreaUnit: 'ft2',
          pitchRise: '6',
          pitchRun: '12',
        },
      ],
      edges: {
        eave: '160',
        rake: '0',
        ridge: '40',
        hip: '75',
        valley: '15',
        unit: 'ft',
      },
      wastePercent: '10',
      materials: EXAMPLE_MATERIAL_SPECS,
      laborRatePerSquare: EXAMPLE_LABOR.ratePerSquare as string,
      overheadPercent: '10',
      markupPercent: '30',
    });

    expect(dec(result.takeoff.slopedFt2!).toFixed(4)).toBe('1341.6408');
    expect(dec(result.takeoff.squares!).toFixed(6)).toBe(
      dec('1341.6408').div(100).toFixed(6),
    );
    expect(result.materials.map((l) => [l.code, l.orderPacks])).toEqual([
      ['shingles', '45'],
      ['underlayment', '2'],
      ['starter', '2'],
      ['ridge_cap', '6'],
      ['drip_edge', '16'],
      ['valley', '2'],
      ['vents', '4'],
    ]);
    expect(result.estimate.status).toBe('priced');
    expect(result.estimate.scenarios!.base.directCost.amount).toBe('4341.06');
    expect(result.wasteRate).toBe('0.1');
  });

  it('accepts metric plan area and converts via package units', () => {
    const planM2 = convertQuantity('100', 'ft2', 'm2').toString();
    const result = computeRoofEstimate({
      facets: [
        {
          id: 'flat',
          structureId: 'house',
          planArea: planM2,
          planAreaUnit: 'm2',
          pitchRise: '0',
          pitchRun: '12',
        },
      ],
      edges: { eave: '', rake: '', ridge: '', hip: '', valley: '', unit: 'ft' },
      wastePercent: '0',
      materials: [EXAMPLE_MATERIAL_SPECS[0]!],
      laborRatePerSquare: '0',
      overheadPercent: '0',
      markupPercent: '0',
    });
    expect(dec(result.takeoff.planFt2).toFixed(0)).toBe('100');
    expect(dec(result.takeoff.slopedFt2!).toString()).toBe('100');
    expect(dec(result.takeoff.squares!).toString()).toBe('1');
  });

  it('leaves sloped area unresolved when pitch is blank', () => {
    const result = computeRoofEstimate({
      facets: [
        {
          id: 'unknown',
          structureId: 'house',
          planArea: '100',
          planAreaUnit: 'ft2',
          pitchRise: '',
          pitchRun: '',
        },
      ],
      edges: { eave: '', rake: '', ridge: '', hip: '', valley: '', unit: 'ft' },
      wastePercent: '10',
      materials: [EXAMPLE_MATERIAL_SPECS[0]!],
      laborRatePerSquare: '95',
      overheadPercent: '0',
      markupPercent: '0',
    });
    expect(result.takeoff.slopedFt2).toBeNull();
    expect(result.estimate.status).toBe('pending_review');
    expect(result.estimate.firm).toBe(false);
  });
});
