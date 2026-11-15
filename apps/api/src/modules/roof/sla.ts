// Roof delivery SLA policy (RF-021 B, RR-039, COS-215). The policy is versioned and frozen into the
// order's creation event, so later policy changes never rewrite a promise already made. Honest by
// construction: DIY is instant because the contractor draws it; assisted work is a queued TARGET
// in business hours with no guarantee, because no staffed measurement operation exists yet (the
// `guaranteed` flag only turns true when ops configures a supported commitment).
import type { RoofDeliverySpeed, RoofOrderMode, RoofSla, RoofSlaClass } from '@fieldline/contracts';

export const SLA_POLICY_VERSION = 'roof-sla@1.0.0';

/** Business hours Mon-Fri 08:00-17:00 in the order's time zone. */
const BUSINESS_START = 8;
const BUSINESS_END = 17;

export function slaClassFor(mode: RoofOrderMode, speed: RoofDeliverySpeed): RoofSlaClass {
  if (mode === 'diy') return 'diy_instant';
  return speed === 'priority' ? 'assisted_priority' : 'assisted_queued';
}

function zonedParts(d: Date, timeZone: string): { weekday: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? 'Mon');
  return { weekday, hour: Number(parts.hour) };
}

/** Adds business hours by stepping whole hours (deterministic; DST handled by the zone formatter). */
export function addBusinessHours(start: Date, hours: number, timeZone: string): Date {
  let t = new Date(Math.ceil(start.getTime() / 3_600_000) * 3_600_000);
  let left = hours;
  let guard = 0;
  while (left > 0 && guard < 24 * 365) {
    const { weekday, hour } = zonedParts(t, timeZone);
    const open = weekday >= 1 && weekday <= 5 && hour >= BUSINESS_START && hour < BUSINESS_END;
    t = new Date(t.getTime() + 3_600_000);
    if (open) left -= 1;
    guard += 1;
  }
  return t;
}

export function computeSla(input: { mode: RoofOrderMode; speed: RoofDeliverySpeed; now: Date; timeZone: string; complexStructures?: number }): RoofSla {
  const slaClass = slaClassFor(input.mode, input.speed);
  const base = { policyVersion: SLA_POLICY_VERSION, slaClass, timeZone: input.timeZone, pausesOn: [] as string[], exclusions: [] as string[] };
  if (slaClass === 'diy_instant') {
    return {
      ...base,
      guaranteed: false,
      targetBusinessHours: 0,
      dueAt: null,
      disclosure: 'DIY: you draw the roof yourself, so the report is available as soon as you finish tracing. No delivery guarantee applies.',
    };
  }
  // A multi-structure order cannot inherit the single-roof target (RR-039 S).
  const hours = (slaClass === 'assisted_priority' ? 8 : 16) + Math.max(0, (input.complexStructures ?? 1) - 1) * 8;
  return {
    ...base,
    guaranteed: false,
    targetBusinessHours: hours,
    dueAt: addBusinessHours(input.now, hours, input.timeZone).toISOString(),
    pausesOn: ['clarification_needed', 'imagery_pending'],
    exclusions: ['obstructed_or_changed_building', 'no_licensed_imagery', 'weekends_and_holidays', 'complex_or_nonplanar_roof'],
    disclosure:
      'Assisted measurement is queued for human review. The time shown is a target in business hours, not a guarantee; it pauses while we wait for licensed imagery or your clarification.',
  };
}
