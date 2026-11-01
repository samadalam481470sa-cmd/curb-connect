import { describe, expect, it } from 'vitest';
import { curbCostLines, curbQuantities, priceEstimate } from '@fieldline/pricing';

/**
 * Mirrors the firm-refusal safety rule used by POST /v1/curb/projects/:id/calculate:
 * unknown deck/utilities => firm must be false and requiresFieldVerification true.
 */
function curbCalcWithSafety(flags: { deckUnknown: boolean; utilitiesUnknown: boolean }) {
  const q = curbQuantities({
    segments: [{ id: 's1', kind: 'straight', length: '18', unit: 'ft' }],
    sawPasses: 2,
    cutDepth: { state: 'known', value: '6', unit: 'in' },
    removalWidth: { state: 'known', value: '2', unit: 'ft' },
    crossSection: { state: 'known', value: '1.5', unit: 'ft2' },
    restorationLength: { state: 'known', value: '18', unit: 'ft' },
    restorationWidth: { state: 'known', value: '2', unit: 'ft' },
  });
  const book = [
    { code: 'saw_lf', unit: 'ft', rate: '20', revision: 'synthetic' },
    { code: 'mob', unit: 'each', rate: '400', revision: 'synthetic' },
    { code: 'breakout_lf', unit: 'ft', rate: '28', revision: 'synthetic' },
    { code: 'disposal_load', unit: 'each', rate: '220', revision: 'synthetic' },
    { code: 'replace_lf', unit: 'ft', rate: '95', revision: 'synthetic' },
    { code: 'traffic', unit: 'each', rate: '350', revision: 'synthetic' },
    { code: 'permit', unit: 'each', rate: '200', revision: 'synthetic' },
  ];
  const recipe = {
    id: 'driveway-opening',
    version: '1.0.0',
    components: [
      { code: 'cutting', description: 'Saw', category: 'labor' as const, basis: 'cut_length_ft' as const, priceItem: 'saw_lf', critical: true },
      { code: 'mobilization', description: 'Mob', category: 'fixed' as const, basis: 'fixed' as const, priceItem: 'mob', critical: true },
      { code: 'breakout', description: 'Breakout', category: 'labor' as const, basis: 'cut_length_ft' as const, priceItem: 'breakout_lf', critical: true },
      { code: 'disposal', description: 'Disposal', category: 'disposal' as const, basis: 'fixed' as const, priceItem: 'disposal_load', critical: true },
      { code: 'replacement', description: 'Replace', category: 'subcontract' as const, basis: 'restoration_length_ft' as const, priceItem: 'replace_lf', critical: true },
      { code: 'traffic_control', description: 'Traffic', category: 'traffic_control' as const, basis: 'fixed' as const, priceItem: 'traffic', critical: true },
      { code: 'permit_allowance', description: 'Permit', category: 'permit' as const, basis: 'fixed' as const, priceItem: 'permit', critical: true, taxable: false },
    ],
  };
  const lines = curbCostLines(q, recipe, book);
  const estimate = priceEstimate({
    trade: 'curb',
    lines,
    recipe: 'driveway-opening@1.0.0',
    policy: {
      currency: 'USD',
      overheadRate: '0.10',
      price: { method: 'target_margin', marginRate: '0.25' },
      revision: 'synthetic',
    },
  });
  const refuseReasons: string[] = [];
  if (flags.deckUnknown) refuseReasons.push('Deck condition is unknown');
  if (flags.utilitiesUnknown) refuseReasons.push('Utility locations are unknown');
  const firmRefused = refuseReasons.length > 0;
  return {
    requiresFieldVerification: true as const,
    firm: firmRefused ? false : estimate.firm,
    firmRefused,
    firmRefuseReasons: refuseReasons,
    engineFirm: estimate.firm,
  };
}

describe('curb calculate safety', () => {
  it('allows firm when deck and utilities are known', () => {
    const result = curbCalcWithSafety({ deckUnknown: false, utilitiesUnknown: false });
    expect(result.requiresFieldVerification).toBe(true);
    expect(result.engineFirm).toBe(true);
    expect(result.firm).toBe(true);
    expect(result.firmRefused).toBe(false);
  });

  it('refuses firm when deck is unknown', () => {
    const result = curbCalcWithSafety({ deckUnknown: true, utilitiesUnknown: false });
    expect(result.requiresFieldVerification).toBe(true);
    expect(result.firm).toBe(false);
    expect(result.firmRefused).toBe(true);
    expect(result.firmRefuseReasons[0]).toMatch(/Deck/);
  });

  it('refuses firm when utilities are unknown', () => {
    const result = curbCalcWithSafety({ deckUnknown: false, utilitiesUnknown: true });
    expect(result.firm).toBe(false);
    expect(result.firmRefused).toBe(true);
  });
});
