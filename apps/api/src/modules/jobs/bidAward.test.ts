// Connectivity build 5: bid award -> optional work assignment planning + honest notes.
import { describe, expect, it } from 'vitest';
import { bidAwardAssignmentNote, bidAwardAssignmentPlan } from './index';

describe('bidAwardAssignmentPlan', () => {
  it('attempts only on accept with the flag set', () => {
    expect(bidAwardAssignmentPlan({ decision: 'accepted', createAssignment: true })).toEqual({
      attempt: true,
    });
    expect(bidAwardAssignmentPlan({ decision: 'accepted' })).toEqual({ attempt: false });
    expect(bidAwardAssignmentPlan({ decision: 'accepted', createAssignment: false })).toEqual({
      attempt: false,
    });
    expect(bidAwardAssignmentPlan({ decision: 'declined', createAssignment: true })).toEqual({
      attempt: false,
    });
  });
});

describe('bidAwardAssignmentNote', () => {
  it('says the award stands when the assignment cannot be created', () => {
    expect(bidAwardAssignmentNote('created')).toContain('created');
    expect(bidAwardAssignmentNote('not_connected')).toContain('awarded');
    expect(bidAwardAssignmentNote('not_connected')).toContain('not an active connection');
    expect(bidAwardAssignmentNote('failed')).toContain('awarded');
  });
});
