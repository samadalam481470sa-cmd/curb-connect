// Follow-up per-item state: snoozes, completions and cadence overrides.
//
// There is no follow_ups table yet (no migration in this build), so this state lives
// in memory for the process lifetime — the same pattern the funnel used before
// migration 0035 landed. The derived queue (queue.ts) is the source of truth for
// what is due; this store only records what a person did to an item. A future
// migration can persist these rows without changing the derivation.
import type { CallOutcome } from '../permitLeads/funnel/stages';
import { emptyFollowUpOverride, validCadenceDays, type FollowUpOverride } from './queue';

export interface FollowUpStore {
  getOverrides(): Promise<Map<string, FollowUpOverride>>;
  getOverride(id: string): Promise<FollowUpOverride>;
  snooze(id: string, snoozedUntil: string): Promise<FollowUpOverride>;
  complete(
    id: string,
    outcome: CallOutcome,
    note: string,
    completedAt: string,
  ): Promise<FollowUpOverride>;
  setCadence(id: string, cadenceDays: number): Promise<FollowUpOverride | null>;
}

export function createMemoryFollowUpStore(): FollowUpStore {
  const overrides = new Map<string, FollowUpOverride>();
  const get = (id: string): FollowUpOverride =>
    overrides.get(id) ?? emptyFollowUpOverride();
  const put = (id: string, next: FollowUpOverride): FollowUpOverride => {
    overrides.set(id, next);
    return next;
  };
  return {
    async getOverrides() {
      return new Map(overrides);
    },
    async getOverride(id) {
      return get(id);
    },
    async snooze(id, snoozedUntil) {
      return put(id, { ...get(id), snoozedUntil });
    },
    async complete(id, outcome, note, completedAt) {
      // Completing clears a snooze: the next due date is one cadence after completion.
      return put(id, {
        ...get(id),
        snoozedUntil: null,
        completedAt,
        lastOutcome: outcome,
        lastNote: note,
      });
    },
    async setCadence(id, cadenceDays) {
      const valid = validCadenceDays(cadenceDays);
      if (valid === null) return null;
      return put(id, { ...get(id), cadenceDays: valid });
    },
  };
}
