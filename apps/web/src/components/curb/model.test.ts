import { CURB_SERVICE_CODES } from '@fieldline/contracts';
import { describe, expect, it } from 'vitest';
import {
  allowedSources,
  answerText,
  autosaveReducer,
  CURB_SERVICE_TAXONOMY,
  earlyQuestionsAnswered,
  EARLY_QUESTIONS,
  estimateBanner,
  gateTarget,
  pieceProblem,
  scaleBar,
  segmentConfidence,
  splitInputs,
  toleranceLevel,
} from './model';

describe('curb model', () => {
  it('CV-041-FE: taxonomy covers every service code; other_concrete_cut needs human scoping', () => {
    expect(CURB_SERVICE_TAXONOMY.map((s) => s.code).sort()).toEqual([...CURB_SERVICE_CODES].sort());
    expect(CURB_SERVICE_TAXONOMY.find((s) => s.code === 'other_concrete_cut')?.needsHumanScoping).toBe(true);
  });

  it('CV-042-FE: price gate needs every early question answered; Unknown counts as answered, never as No', () => {
    expect(earlyQuestionsAnswered([]).done).toBe(false);
    const all = EARLY_QUESTIONS.map((q) => ({ questionKey: q.key, answer: { state: 'unknown' } }));
    expect(earlyQuestionsAnswered(all).done).toBe(true);
    expect(earlyQuestionsAnswered(all.slice(1)).missing).toEqual([EARLY_QUESTIONS[0]!.key]);
    expect(answerText({ state: 'unknown' })).toBe('Unknown');
    expect(answerText(undefined)).toBe('Not answered');
  });

  it('CV-045-FE: tolerance bands against the 5% API limit', () => {
    expect(toleranceLevel(0.01)).toBe('within');
    expect(toleranceLevel(0.04)).toBe('marginal');
    expect(toleranceLevel(0.051)).toBe('refused');
    expect(toleranceLevel(null)).toBe('unknown');
  });

  it('CV-047-FE: confidence colour bands and curve-needs-3-points', () => {
    expect(segmentConfidence({ source: 'field_verified' })).toBe('verified');
    expect(segmentConfidence({ source: 'imagery_derived', lengthM: 10, sigmaM: 0.05 })).toBe('high');
    expect(segmentConfidence({ source: 'imagery_derived', lengthM: 10, sigmaM: 0.2 })).toBe('medium');
    expect(segmentConfidence({ source: 'imagery_derived', lengthM: 10, sigmaM: 1 })).toBe('low');
    expect(segmentConfidence({ source: 'imagery_derived', lengthM: null, sigmaM: null })).toBe('unknown');
    expect(pieceProblem('curved', [[0, 0], [1, 1]])).toMatch(/three points/);
    expect(pieceProblem('straight', [[0, 0], [1, 1]])).toBeNull();
  });

  it('CV-047-FE: scale bar picks a round length near the target width', () => {
    const bar = scaleBar(0.005, 1, 120); // 5 mm/px -> 0.5 m = 100 px
    expect(bar).toMatchObject({ meters: 0.5, label: '50 cm' });
    expect(scaleBar(null)).toBeNull();
  });

  it('CV-045-FE: depth/thickness never from photos; verified sources need permission', () => {
    expect(allowedSources('cut_depth', true)).not.toContain('imagery_derived');
    expect(allowedSources('cut_length', false)).toEqual(['user_entered', 'imagery_derived']);
  });

  it('CP-058-FE: banner shows unless firm + binding + priced + fresh', () => {
    const firm = { isBinding: true, quoteKind: 'firm', scenarios: {} };
    expect(estimateBanner(firm, null).show).toBe(false);
    expect(estimateBanner(firm, { since: 'x', reason: 'r' }).show).toBe(true);
    expect(estimateBanner({ ...firm, isBinding: false, quoteKind: 'budgetary_range' }, null).title).toMatch(/BUDGETARY/);
    expect(estimateBanner({ ...firm, scenarios: null }, null).title).toMatch(/REVIEW REQUIRED/);
    expect(estimateBanner(null, null).show).toBe(true);
  });

  it('CP-058-FE: unknown inputs are separated', () => {
    expect(splitInputs({ a: { state: 'known' }, b: { state: 'unknown' } })).toEqual({ known: ['a'], unknown: ['b'] });
  });

  it('CP-059-FE: gate codes route to the tab that fixes them', () => {
    expect(gateTarget('permit_unresolved')).toBe('risks');
    expect(gateTarget('calibration_missing')).toBe('measure');
    expect(gateTarget('estimate_not_approved')).toBe('estimate');
  });

  it('autosave: conflict survives edits until reload', () => {
    expect(autosaveReducer('saved', 'edit')).toBe('unsaved');
    expect(autosaveReducer('conflict', 'edit')).toBe('conflict');
    expect(autosaveReducer('conflict', 'reload')).toBe('saved');
    expect(autosaveReducer('saving', 'save_offline')).toBe('offline');
  });
});
