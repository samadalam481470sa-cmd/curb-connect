// RR-039-QA: SLA classes are honest targets; business-hour clocks skip nights and weekends.
import { describe, expect, it } from 'vitest';
import { addBusinessHours, computeSla } from './sla';

describe('RR-039-API roof SLA policy', () => {
  it('DIY is instant with no guarantee', () => {
    const s = computeSla({ mode: 'diy', speed: 'instant_diy', now: new Date('2026-10-23T10:00:00Z'), timeZone: 'UTC' });
    expect(s).toMatchObject({ slaClass: 'diy_instant', guaranteed: false, dueAt: null });
  });

  it('a Friday-evening assisted order lands on business hours of the next week', () => {
    // Fri 2026-10-23 18:00 UTC: closed until Mon 08:00; 16 business hours = Mon 9 h + Tue 7 h -> Tue 15:00.
    const s = computeSla({ mode: 'assisted', speed: 'standard', now: new Date('2026-10-23T18:00:00Z'), timeZone: 'UTC' });
    expect(s).toMatchObject({ slaClass: 'assisted_queued', guaranteed: false, targetBusinessHours: 16 });
    expect(s.dueAt).toBe('2026-10-27T15:00:00.000Z');
  });

  it('multi-structure orders get a longer target, never the single-roof promise', () => {
    const one = computeSla({ mode: 'assisted', speed: 'priority', now: new Date('2026-10-26T08:00:00Z'), timeZone: 'UTC' });
    const three = computeSla({ mode: 'assisted', speed: 'priority', now: new Date('2026-10-26T08:00:00Z'), timeZone: 'UTC', complexStructures: 3 });
    expect(one.targetBusinessHours).toBe(8);
    expect(three.targetBusinessHours).toBe(24);
    expect(addBusinessHours(new Date('2026-10-26T08:00:00Z'), 8, 'UTC').toISOString()).toBe('2026-10-26T16:00:00.000Z');
  });
});
