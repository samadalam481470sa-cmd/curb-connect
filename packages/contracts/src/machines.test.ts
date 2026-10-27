import { describe, expect, it } from 'vitest';
import {
  curbEstimateMachine,
  DEFAULT_JOB_STAGES,
  defaultJobStageMachine,
  defineStateMachine,
  InvalidTransitionError,
  invoiceMachine,
  proposalMachine,
  roofOrderMachine,
  STATE_MACHINES,
  type StateMachine,
} from './index';

describe('state machines', () => {
  it('every machine is well formed (states reachable, terminals have no exits)', () => {
    for (const machine of Object.values(STATE_MACHINES) as unknown as StateMachine<string>[]) {
      expect(machine.states).toContain(machine.initial);
      for (const t of machine.terminal) expect(machine.nextStates(t)).toEqual([]);
    }
  });

  it('roof order (RR-006/039): happy path and forbidden shortcuts', () => {
    const path = ['draft', 'ordered', 'measuring', 'review_required', 'approved', 'quoted', 'won', 'invoiced', 'paid'] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(roofOrderMachine.canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
    expect(roofOrderMachine.canTransition('draft', 'approved')).toBe(false);
    expect(roofOrderMachine.canTransition('measuring', 'approved')).toBe(false);
    expect(roofOrderMachine.isTerminal('paid')).toBe(true);
    expect(() => roofOrderMachine.assertTransition('paid', 'draft')).toThrow(InvalidTransitionError);
  });

  it('curb estimate (CP-050): approval only from pricing_ready', () => {
    for (const s of curbEstimateMachine.states) {
      expect(curbEstimateMachine.canTransition(s, 'approved')).toBe(s === 'pricing_ready');
    }
  });

  it('proposal and invoice: voided/void are terminal; paid cannot go back to issued', () => {
    expect(proposalMachine.isTerminal('voided')).toBe(true);
    expect(proposalMachine.canTransition('draft', 'accepted')).toBe(false);
    expect(invoiceMachine.isTerminal('void')).toBe(true);
    expect(invoiceMachine.canTransition('paid', 'issued')).toBe(false);
  });

  it('job stages follow the configurable pipeline data', () => {
    const first = DEFAULT_JOB_STAGES[0]!;
    const canMove = defaultJobStageMachine.canTransition as (from: string, to: string) => boolean;
    for (const next of first.allowedNext) expect(canMove(first.key, next)).toBe(true);
    expect(canMove(first.key, first.key)).toBe(false);
  });

  it('rejects malformed definitions', () => {
    expect(() =>
      defineStateMachine({ name: 'bad', states: ['a', 'b'] as const, initial: 'a', transitions: { a: [], b: ['a'] } }),
    ).toThrow(/unreachable/);
    expect(() =>
      defineStateMachine({ name: 'bad', states: ['a'] as const, initial: 'a', transitions: { a: ['a'] } }),
    ).toThrow(/self-transition/);
  });
});
