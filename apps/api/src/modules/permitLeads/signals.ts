// Evidence-based signals. A missing trade permit in a bounded search does NOT mean
// the trade is unawarded; permit dates are not construction start-date predictions.
import type { ProjectType, RawPermit, Trade } from './engine';

export type LeadStage = 'planning' | 'application' | 'permitted' | 'completed' | 'unknown';
export type TradeEvidence = 'recorded' | 'not_observed' | 'unknown' | 'not_applicable';

export function stageOf(p: RawPermit): LeadStage {
  const t = [p.status, p.permitType, p.workClass].join(' ').toLowerCase();
  if (/complete|closed|finaled|certificate of occupancy/.test(p.status.toLowerCase()))
    return 'completed';
  // A site-plan or zoning filing is not itself a building permit.
  if (/pre.?application|site.?plan|zoning|planning|preliminary plat|plat review/.test(t)
      && !p.issuedAt) return 'planning';
  if (p.issuedAt || /\bissued\b|permit approved/.test(p.status.toLowerCase())) return 'permitted';
  if (p.appliedAt || /review|pending|submitted|application/.test(t)) return 'application';
  return 'unknown';
}

/** Normalized address+city key used to group permits at the same property. */
export function addressKey(p: RawPermit): string {
  const address = p.address.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const city = p.city.toUpperCase().replace(/[^A-Z]/g, '');
  return address.length >= 5 && city ? city + ':' + address : '';
}

const TRADE_PERMIT_RE: Partial<Record<Trade, RegExp>> = {
  electrical: /\belectrical?\b|\belectric\b/,
  plumbing: /\bplumbing\b|\bplumb\b/,
  hvac: /\bmechanical\b|\bhvac\b/,
  roofing: /\broofing\b|\broof\b/,
  // Finish trades rarely pull a permit of their own — flooring, cabinets and fixtures usually
  // ride on the parent remodel/TI permit. This pattern only counts a separate finish-out or
  // trade-specific permit at the same address; "not_observed" here must never be read as
  // "no finish subcontractor hired" (see the note in finishOuts.ts).
  finish_out:
    /\bfinish[ -]?out\b|\btenant improvement\b|\bflooring\b|\bcabinets?\b|\bcountertops?\b|\bmillwork\b/,
};

export function tradeEvidence(
  lead: RawPermit,
  trade: Trade,
  allPermits: readonly RawPermit[],
): TradeEvidence {
  const regex = TRADE_PERMIT_RE[trade];
  if (!regex) return 'not_applicable';
  const key = addressKey(lead);
  if (!key) return 'unknown';
  const found = allPermits.some((p) =>
    addressKey(p) === key &&
    regex.test([p.permitType, p.workClass].join(' ').toLowerCase()) &&
    (p.source === lead.source || p.city.toLowerCase() === lead.city.toLowerCase()),
  );
  return found ? 'recorded' : 'not_observed';
}

/** Trades whose permits can be recognized from the published type/work class. */
export const OBSERVABLE_TRADES = ['electrical', 'plumbing', 'hvac', 'roofing', 'finish_out'] as const;
export type ObservableTrade = (typeof OBSERVABLE_TRADES)[number];

/**
 * Which trade a permit belongs to, from the city's published permit type /
 * work class only (the same evidence basis as tradeEvidence). Null when the
 * published fields name no trade — never guessed from the description.
 */
export function permitTradeOf(p: RawPermit): ObservableTrade | null {
  const t = [p.permitType, p.workClass].join(' ').toLowerCase();
  for (const trade of OBSERVABLE_TRADES) {
    const regex = TRADE_PERMIT_RE[trade];
    if (regex && regex.test(t)) return trade;
  }
  return null;
}

export interface PlainRule {
  minimumValue: number;
  projectTypes: ProjectType[];
  interpreted: string[];
}

/** Narrow, auditable parser for common contractor search rules; not an LLM SQL generator.
 * Unrecognized words have no effect. Never translate user text into executable SQL.
 */
export function parsePlainRule(rule: string): PlainRule {
  const t = rule.toLowerCase();
  const types: ProjectType[] = [];
  if (/\bcommercial\b|\bwarehouse\b|\bretail\b|\boffice\b/.test(t)) types.push('commercial');
  if (/\bmultifamily\b|\bmulti.family\b|\bapartment\b|\bcondo\b/.test(t)) types.push('multifamily');
  if (/\bsite work\b|\bland development\b|\bgrading\b/.test(t)) types.push('site_work');
  if (/\btownhome\b|\btownhouse\b/.test(t)) types.push('townhome');
  const m = /(?:over|above|at least|more than|greater than|minimum|>)\s*\$?\s*(\d+(?:\.\d+)?|a|one)\s*(million|millions|m|thousand|k)?\b/.exec(t);
  const n = m?.[1] === 'a' || m?.[1] === 'one' ? 1 : Number(m?.[1] ?? 0);
  const multiplier = m?.[2]?.startsWith('m') ? 1_000_000 : m?.[2]?.startsWith('k') || m?.[2] === 'thousand' ? 1_000 : 1;
  const minimumValue = Number.isFinite(n) && n > 0 ? Math.min(n * multiplier, 50_000_000_000) : 0;
  const interpreted = [
    ...(minimumValue ? ['Minimum listed value: $' + minimumValue.toLocaleString('en-US')] : []),
    ...(types.length ? ['Project types: ' + types.join(', ')] : []),
  ];
  return { minimumValue, projectTypes: types, interpreted };
}
