import { describe, expect, it } from 'vitest';
import { classifyPlanText, evidenceSnippet } from './trades';

describe('classifyPlanText', () => {
  it('finds trade items named on the plan, in build-sequence order', () => {
    const lines = classifyPlanText(
      'ROOFING: architectural shingles. FOOTINGS 24" wide. Excavate to firm bearing. Rebar #4 @ 18" o.c. Vapor barrier 6 mil poly. Structural steel beam W8x31.',
    );
    const trades = lines.map((l) => l.trade);
    // One line per matched rule, in build-sequence order: rebar and vapor barrier are
    // two separate rules under the same trade.
    expect(trades).toEqual(['excavation', 'foundations', 'rebar_vapor', 'rebar_vapor', 'structural_steel', 'roofing']);
    expect(lines.map((l) => l.label)).toEqual([
      'Excavation / earthwork',
      'Footings',
      'Rebar / reinforcing steel',
      'Vapor barrier / retarder',
      'Structural steel beams / columns',
      'Roofing / shingles',
    ]);
    expect(lines.every((l) => l.source === 'plan_text')).toBe(true);
    // A keyword says the item is on the plan, not how much of it there is.
    expect(lines.every((l) => l.quantity === null)).toBe(true);
    expect(lines.every((l) => l.evidence !== null && l.evidence.length > 0)).toBe(true);
  });

  it('matches underground plumbing, electrical, plumbing and HVAC', () => {
    const text = 'Underground sewer main to street. Electrical panel 200A. Water heater 50 gal. HVAC: 3-ton condenser, ductwork throughout.';
    const trades = classifyPlanText(text).map((l) => l.trade);
    expect(trades).toContain('underground_plumbing');
    expect(trades).toContain('electrical');
    expect(trades).toContain('plumbing');
    expect(trades).toContain('hvac');
  });

  it('does not match look-alike words', () => {
    // "carpool" is not a pool, "whirlpool" is not a pool permit item here, and "Liverpool"
    // must not trip the pool rules — and none of these words are trade keywords at all.
    const lines = classifyPlanText('The carpool meets at Liverpool. Whirlpool tub in the primary bath.');
    expect(lines).toEqual([]);
  });

  it('returns one line per rule even when the keyword repeats', () => {
    const lines = classifyPlanText('Footings. Footings. Footings everywhere. More footings.');
    expect(lines.filter((l) => l.label === 'Footings')).toHaveLength(1);
  });

  it('returns nothing for empty text', () => {
    expect(classifyPlanText('')).toEqual([]);
    expect(classifyPlanText('   ')).toEqual([]);
  });

  it('evidenceSnippet quotes around the match', () => {
    const text = 'A'.repeat(100) + ' vapor barrier ' + 'B'.repeat(100);
    const snippet = evidenceSnippet(text, 100, 15);
    expect(snippet).toContain('vapor barrier');
    expect(snippet.length).toBeLessThanOrEqual(201);
  });
});
