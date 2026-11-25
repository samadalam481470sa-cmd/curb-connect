// Follow-up queue: pure derivation logic (no database, no network) so it can be
// unit-tested with mocked data.
//
// A due re-contact is a quoted-not-won roof quote or a funnel lead in Quoted /
// Interested / Lost whose last contact was long enough ago. Cadence is per stage
// (quoted 7 days, interested 14, lost 30) and can be overridden per item. Nothing
// is ever sent automatically: this module only lists what is due and records what
// a person did (complete / snooze). Automation stays off behind the
// `roof.follow_up_automation` flag (default off); see index.ts.
import {
  FUNNEL_STAGE_LABEL,
  isFunnelStage,
  type CallOutcome,
  type FunnelStage,
} from '../permitLeads/funnel/stages';

const DAY_MS = 86_400_000;

/** Days since last contact before a stage comes due again. */
export const FOLLOW_UP_CADENCE_DAYS = {
  quoted: 7,
  interested: 14,
  lost: 30,
} as const;
export const FOLLOW_UP_STAGES = ['quoted', 'interested', 'lost'] as const;
export type FollowUpStage = (typeof FOLLOW_UP_STAGES)[number];

export function isFollowUpStage(v: unknown): v is FollowUpStage {
  return (
    typeof v === 'string' &&
    (Object.keys(FOLLOW_UP_CADENCE_DAYS) as string[]).includes(v)
  );
}

export function cadenceDaysFor(stage: FollowUpStage): number {
  return FOLLOW_UP_CADENCE_DAYS[stage];
}

export type FollowUpSource = 'funnel' | 'roof_order';

/** One funnel stage row, as stored by the funnel module (permit_funnel_stages). */
export interface FunnelFollowUpInput {
  leadKey: string;
  stage: FunnelStage;
  callCount: number;
  lastCallAt: string | null;
  lastNote: string | null;
  /** Address / city when the caller knows them (from the live funnel lead, optional). */
  address?: string | null;
  city?: string | null;
}

/** One roof order in status 'quoted' (quoted, not won). */
export interface RoofOrderFollowUpInput {
  id: string;
  number: string;
  /** Last activity on the order; used as the last-contact proxy (no call log exists
   *  on roof orders, so this is labelled as such in the due reason). */
  updatedAt: string;
  jobId: string | null;
}

/** Per-item manual state kept by the follow-up store (in-memory; see store.ts). */
export interface FollowUpOverride {
  snoozedUntil: string | null;
  completedAt: string | null;
  lastOutcome: CallOutcome | null;
  lastNote: string | null;
  /** Per-item cadence override in days (null = stage default). */
  cadenceDays: number | null;
}

export function emptyFollowUpOverride(): FollowUpOverride {
  return {
    snoozedUntil: null,
    completedAt: null,
    lastOutcome: null,
    lastNote: null,
    cadenceDays: null,
  };
}

export interface FollowUpItem {
  /** Stable id: `funnel:<leadKey>` or `roof-order:<roofOrderId>`. URL-encode it in paths. */
  id: string;
  source: FollowUpSource;
  leadKey: string | null;
  roofOrderId: string | null;
  roofOrderNumber: string | null;
  address: string | null;
  city: string | null;
  stage: FollowUpStage;
  stageLabel: string;
  callCount: number;
  lastContactAt: string | null;
  lastOutcome: CallOutcome | null;
  lastNote: string | null;
  /** ISO timestamp the item came (or comes) due. */
  dueAt: string;
  /** Whole days past due (0 when due today, negative never — due items only). */
  overdueDays: number;
  /** Plain-language reason, naming the last contact (or its absence). */
  dueReason: string;
  suggestedTemplateId: string;
  snoozedUntil: string | null;
  cadenceDays: number;
}

export function followUpIdForFunnel(leadKey: string): string {
  return `funnel:${leadKey}`;
}

export function followUpIdForRoofOrder(roofOrderId: string): string {
  return `roof-order:${roofOrderId}`;
}

/** Split an item id back into its source and key. Null when the id is not ours. */
export function parseFollowUpId(
  id: string,
): { source: FollowUpSource; key: string } | null {
  if (id.startsWith('funnel:')) {
    const key = id.slice('funnel:'.length);
    return key.length > 0 ? { source: 'funnel', key } : null;
  }
  if (id.startsWith('roof-order:')) {
    const key = id.slice('roof-order:'.length);
    return key.length > 0 ? { source: 'roof_order', key } : null;
  }
  return null;
}

export function suggestedTemplateIdFor(stage: FollowUpStage): string {
  return stage === 'quoted'
    ? 'quoted_follow_up'
    : stage === 'interested'
      ? 'interested_follow_up'
      : 'lost_reopen';
}

function daysBetween(fromIso: string, to: Date): number {
  const ms = to.getTime() - Date.parse(fromIso);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor(ms / DAY_MS));
}

function funnelItem(
  row: FunnelFollowUpInput,
  now: Date,
  override: FollowUpOverride,
): FollowUpItem | null {
  if (!isFollowUpStage(row.stage)) return null;
  const stage = row.stage as FollowUpStage;
  const cadence = override.cadenceDays ?? FOLLOW_UP_CADENCE_DAYS[stage];
  const lastContactAt = row.lastCallAt;
  const lastOutcome = override.lastOutcome;
  const lastNote = override.lastNote ?? row.lastNote;
  // A completed follow-up comes due again one cadence after it was completed.
  const base = override.completedAt ?? lastContactAt;
  const dueAt = base
    ? new Date(Date.parse(base) + cadence * DAY_MS)
    : new Date(now.getTime());
  const snoozed = override.snoozedUntil ? Date.parse(override.snoozedUntil) : null;
  const effectiveDue =
    snoozed !== null && !Number.isNaN(snoozed) && snoozed > dueAt.getTime()
      ? new Date(snoozed)
      : dueAt;
  const daysSinceContact = lastContactAt ? daysBetween(lastContactAt, now) : null;
  return {
    id: followUpIdForFunnel(row.leadKey),
    source: 'funnel',
    leadKey: row.leadKey,
    roofOrderId: null,
    roofOrderNumber: null,
    address: row.address ?? null,
    city: row.city ?? null,
    stage,
    stageLabel: FUNNEL_STAGE_LABEL[stage],
    callCount: row.callCount,
    lastContactAt,
    lastOutcome,
    lastNote,
    dueAt: effectiveDue.toISOString(),
    overdueDays: Math.max(0, daysBetween(effectiveDue.toISOString(), now)),
    dueReason:
      daysSinceContact === null
        ? `No contact recorded yet for this ${FUNNEL_STAGE_LABEL[stage].toLowerCase()} lead — due now.`
        : `Last contact ${daysSinceContact === 0 ? 'today' : `${daysSinceContact} day${daysSinceContact === 1 ? '' : 's'} ago`} — ${FUNNEL_STAGE_LABEL[stage]} leads are due again after ${cadence} days.`,
    suggestedTemplateId: suggestedTemplateIdFor(stage),
    snoozedUntil: override.snoozedUntil,
    cadenceDays: cadence,
  };
}

function roofOrderItem(
  order: RoofOrderFollowUpInput,
  now: Date,
  override: FollowUpOverride,
): FollowUpItem {
  const cadence = override.cadenceDays ?? FOLLOW_UP_CADENCE_DAYS.quoted;
  const base = override.completedAt ?? order.updatedAt;
  const dueAt = new Date(Date.parse(base) + cadence * DAY_MS);
  const snoozed = override.snoozedUntil ? Date.parse(override.snoozedUntil) : null;
  const effectiveDue =
    snoozed !== null && !Number.isNaN(snoozed) && snoozed > dueAt.getTime()
      ? new Date(snoozed)
      : dueAt;
  const daysSince = daysBetween(order.updatedAt, now);
  return {
    id: followUpIdForRoofOrder(order.id),
    source: 'roof_order',
    leadKey: null,
    roofOrderId: order.id,
    roofOrderNumber: order.number,
    address: null,
    city: null,
    stage: 'quoted',
    stageLabel: 'Quoted',
    callCount: 0,
    lastContactAt: order.updatedAt,
    lastOutcome: override.lastOutcome,
    lastNote: override.lastNote,
    dueAt: effectiveDue.toISOString(),
    overdueDays: Math.max(0, daysBetween(effectiveDue.toISOString(), now)),
    dueReason: `Roof quote ${order.number} has been quoted for ${daysSince} day${daysSince === 1 ? '' : 's'} with no win recorded — quoted jobs are due for a check-in after ${cadence} days. Last activity on the order is used here because roof orders have no call log.`,
    suggestedTemplateId: 'quoted_follow_up',
    snoozedUntil: override.snoozedUntil,
    cadenceDays: cadence,
  };
}

/**
 * Derive the due follow-up queue. Pure: callers supply the funnel stage rows and the
 * quoted roof orders plus any per-item overrides; only items whose due date has
 * arrived are returned, sorted by due date (most overdue first).
 */
export function deriveFollowUps(
  funnelRows: readonly FunnelFollowUpInput[],
  roofOrders: readonly RoofOrderFollowUpInput[],
  now: Date,
  overrides: ReadonlyMap<string, FollowUpOverride> = new Map(),
): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  for (const row of funnelRows) {
    const item = funnelItem(row, now, overrides.get(followUpIdForFunnel(row.leadKey)) ?? emptyFollowUpOverride());
    if (item && Date.parse(item.dueAt) <= now.getTime()) items.push(item);
  }
  for (const order of roofOrders) {
    const item = roofOrderItem(order, now, overrides.get(followUpIdForRoofOrder(order.id)) ?? emptyFollowUpOverride());
    if (Date.parse(item.dueAt) <= now.getTime()) items.push(item);
  }
  items.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
  return items;
}

/** Re-derive one item by id (used after complete / snooze to return the fresh state). */
export function deriveFollowUpById(
  id: string,
  funnelRows: readonly FunnelFollowUpInput[],
  roofOrders: readonly RoofOrderFollowUpInput[],
  now: Date,
  overrides: ReadonlyMap<string, FollowUpOverride> = new Map(),
): FollowUpItem | null {
  const parsed = parseFollowUpId(id);
  if (!parsed) return null;
  if (parsed.source === 'funnel') {
    const row = funnelRows.find((r) => r.leadKey === parsed.key);
    if (!row) return null;
    return funnelItem(row, now, overrides.get(id) ?? emptyFollowUpOverride());
  }
  const order = roofOrders.find((o) => o.id === parsed.key);
  if (!order) return null;
  return roofOrderItem(order, now, overrides.get(id) ?? emptyFollowUpOverride());
}

/** Validate a per-item cadence override: whole days, 1–90. Null when invalid. */
export function validCadenceDays(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 90) return null;
  return v;
}

export { isFunnelStage };
export type { FunnelStage };
