import { describe, expect, it } from 'vitest';
import { computeApplication, validateApplicationLines } from './calc';

const sov = [
  { id: 'l1', scheduledValueMinor: 100_000 }, // $1,000
  { id: 'l2', scheduledValueMinor: 50_000 }, // $500
];
const none = { completedStoredByLine: new Map<string, number>(), retainageWithheldMinor: 0 };

describe('computeApplication', () => {
  it('first application: percent complete drives completed, retainage withheld, balance remains', () => {
    const r = computeApplication(
      sov,
      [
        { sovLineId: 'l1', percentComplete: 40, storedMaterialsMinor: 0 },
        { sovLineId: 'l2', percentComplete: 0, storedMaterialsMinor: 10_000 },
      ],
      none,
      10,
    );
    expect(r.scheduledTotalMinor).toBe(150_000);
    expect(r.completedStoredTotalMinor).toBe(50_000); // 40k completed + 10k stored
    expect(r.thisPeriodGrossMinor).toBe(50_000);
    expect(r.retainageToDateMinor).toBe(5_000);
    expect(r.retainageThisPeriodMinor).toBe(5_000);
    expect(r.currentDueMinor).toBe(45_000);
    expect(r.balanceToFinishMinor).toBe(100_000);
    expect(r.overbilled).toBe(false);
  });

  it('second application bills only the increment and withholds only new retainage', () => {
    const previous = {
      completedStoredByLine: new Map([['l1', 40_000], ['l2', 10_000]]),
      retainageWithheldMinor: 5_000,
    };
    const r = computeApplication(
      sov,
      [
        { sovLineId: 'l1', percentComplete: 100, storedMaterialsMinor: 0 },
        { sovLineId: 'l2', percentComplete: 50, storedMaterialsMinor: 0 },
      ],
      previous,
      10,
    );
    // completed+stored now 100k + 25k = 125k; previously 50k -> 75k this period.
    expect(r.thisPeriodGrossMinor).toBe(75_000);
    expect(r.retainageToDateMinor).toBe(12_500);
    expect(r.retainageThisPeriodMinor).toBe(7_500);
    expect(r.currentDueMinor).toBe(67_500);
    expect(r.balanceToFinishMinor).toBe(25_000);
  });

  it('flags overbilling when completed + stored exceeds scheduled value', () => {
    const r = computeApplication(
      sov,
      [{ sovLineId: 'l1', percentComplete: 100, storedMaterialsMinor: 5_000 }],
      none,
      0,
    );
    expect(r.overbilled).toBe(true);
    expect(r.lines[0]?.overbilled).toBe(true);
  });

  it('zero retainage means current due equals gross', () => {
    const r = computeApplication(sov, [{ sovLineId: 'l1', percentComplete: 10, storedMaterialsMinor: 0 }], none, 0);
    expect(r.currentDueMinor).toBe(10_000);
    expect(r.retainageToDateMinor).toBe(0);
  });

  it('lines missing from the application bill nothing new', () => {
    const r = computeApplication(sov, [], none, 10);
    expect(r.completedStoredTotalMinor).toBe(0);
    expect(r.currentDueMinor).toBe(0);
  });

  it('rounding: percent of odd amounts rounds to whole minor units', () => {
    const r = computeApplication(
      [{ id: 'x', scheduledValueMinor: 33_333 }],
      [{ sovLineId: 'x', percentComplete: 33, storedMaterialsMinor: 0 }],
      none,
      0,
    );
    expect(r.lines[0]?.completedToDateMinor).toBe(11_000); // 33333*0.33 = 10999.89 -> 11000
  });
});

describe('validateApplicationLines', () => {
  it('rejects unknown lines and out-of-range percents', () => {
    expect(validateApplicationLines(sov, [{ sovLineId: 'nope', percentComplete: 10, storedMaterialsMinor: 0 }])).toMatch(/does not belong/);
    expect(validateApplicationLines(sov, [{ sovLineId: 'l1', percentComplete: 101, storedMaterialsMinor: 0 }])).toMatch(/between 0 and 100/);
    expect(validateApplicationLines(sov, [{ sovLineId: 'l1', percentComplete: 10, storedMaterialsMinor: -1 }])).toMatch(/non-negative/);
    expect(validateApplicationLines(sov, [{ sovLineId: 'l1', percentComplete: 10, storedMaterialsMinor: 0 }])).toBeNull();
  });
});
