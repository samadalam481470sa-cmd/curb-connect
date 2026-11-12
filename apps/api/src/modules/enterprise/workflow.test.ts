import { describe, expect, it } from 'vitest';
import { calculateSov, canTransition, CO_NEXT, RFI_NEXT, SUBMITTAL_NEXT } from './workflow';

describe('enterprise state machines', () => {
  it('enforces only legal RFI transitions', () => {
    expect(canTransition(RFI_NEXT, 'draft', 'open')).toBe(true);
    expect(canTransition(RFI_NEXT, 'draft', 'closed')).toBe(false);
    expect(canTransition(RFI_NEXT, 'open', 'answered')).toBe(true);
    expect(canTransition(RFI_NEXT, 'closed', 'open')).toBe(false);
  });
  it('requires PCO approval to follow owner submission', () => {
    expect(canTransition(CO_NEXT, 'pco_draft', 'approved')).toBe(false);
    expect(canTransition(CO_NEXT, 'submitted_to_owner', 'approved')).toBe(true);
    expect(canTransition(CO_NEXT, 'approved', 'rejected')).toBe(false);
  });
  it('requires resubmission after a revise decision', () => {
    expect(canTransition(SUBMITTAL_NEXT, 'under_review', 'revise_and_resubmit')).toBe(true);
    expect(canTransition(SUBMITTAL_NEXT, 'revise_and_resubmit', 'submitted')).toBe(true);
    expect(canTransition(SUBMITTAL_NEXT, 'rejected', 'approved')).toBe(false);
  });
});

describe('preliminary schedule of values', () => {
  it('calculates retainage using integer minor units', () => {
    const result = calculateSov(
      [{ scheduledMinor: 25000000, previousMinor: 20000000, currentMinor: 5000000,
         storedMinor: 0, retainageBps: 1000 }],
      125000000, 4500000, 61000000,
    );
    expect(result.revisedContractMinor).toBe(129500000);
    expect(result.completedMinor).toBe(25000000);
    expect(result.retainageMinor).toBe(2500000);
    expect(result.earnedLessRetainageMinor).toBe(22500000);
    expect(result.currentPaymentDueMinor).toBe(-38500000);
  });
  it('rejects overbilling instead of silently clamping', () => {
    expect(() => calculateSov(
      [{ scheduledMinor: 100, previousMinor: 50, currentMinor: 60,
         storedMinor: 0, retainageBps: 1000 }], 100, 0,
    )).toThrow('exceeds');
  });
  it('does not affect original contract until approved COs are added', () => {
    expect(calculateSov([], 10000, 0).revisedContractMinor).toBe(10000);
    expect(calculateSov([], 10000, 300).revisedContractMinor).toBe(10300);
  });
});
