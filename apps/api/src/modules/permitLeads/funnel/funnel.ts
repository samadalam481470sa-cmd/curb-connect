// Active Permits Funnel: turn the live Texas permit feeds into ranked, callable leads.
//
// A funnel lead is a permit that is active right now — issued or in review inside the window —
// with the contractor/applicant the city published and a plain-language reason to call now.
// Nothing is invented: contractor, value and owner are only what a public record published;
// a missing phone is reported as missing, never guessed. Ranking is newest-first with a
// "hot" boost for permits issued in the last 7 days with no contractor on file yet (nobody
// has the job locked up) and a trade match. Stale feeds stay in the funnel but are labelled
// stale, so a lead from a feed that stopped publishing is never presented as fresh.
import { classifyProject, type RawPermit, type Trade } from '../engine';
import { assessFreshness } from '../freshness';
import { poolPropertyKey } from '../poolRadar';
import { stageOf } from '../signals';
import { EMPTY_DECISION_MAKER, type DecisionMaker } from './decisionMaker';
import type { FunnelStage } from './stages';

const DAY_MS = 86_400_000;

/** Public-entity owners are not callable sales leads (same idea as the search's
 *  skipPublicOwners flag, applied to the contractor/applicant text the city published). */
const PUBLIC_OWNER =
  /\bcity of\b|\bcounty\b|\bstate of texas\b|school district|\bisd\b|university|housing authority|hospital district|water district|\bchurch\b/i;

/** Permit statuses that mean the job is already done, dead or withdrawn — not callable. */
const DEAD_STATUS = /complete|completed|closed|finaled|expired|denied|withdrawn|cancelled|void/i;

export type CallPriority = 'hot' | 'warm' | 'cool';

export const CALL_PRIORITY_LABEL: Record<CallPriority, string> = {
  hot: 'Call now',
  warm: 'Call this week',
  cool: 'Follow up later',
};

export interface FunnelOwner {
  /** Owner name as published by a county appraisal district, or null when no CAD record matched. */
  name: string | null;
  /** Owner mailing address as published by the appraisal district, or null. */
  mailingAddress: string | null;
  /** Where the owner came from: 'cad' (county appraisal district) or 'permit' (the permit
   *  itself named the applicant/contractor). Null when no owner is known. */
  source: 'cad' | 'permit' | null;
  /** Appraisal year / vintage of the CAD record, when one matched (Dallas is 2019-vintage). */
  vintage: string | null;
}

export interface FunnelContact {
  /** Phone exactly as a public record published it, or null. No phone is ever invented. */
  phone: string | null;
  /** 'permit' when the permit feed published it, 'contacts' when it matched the company's own
   *  CRM contact by name, null when no phone is known. */
  phoneSource: 'permit' | 'contacts' | null;
}

export interface FunnelLead {
  /** Stable key for stage/call storage: source + permit number. */
  key: string;
  source: string;
  sourceName: string;
  permitNumber: string;
  city: string;
  address: string;
  zip: string;
  description: string;
  permitType: string;
  workClass: string;
  status: string;
  issuedAt: string | null;
  appliedAt: string | null;
  /** Whole days since the permit was issued (or applied, when no issue date), null when undated. */
  daysSince: number | null;
  value: number;
  units: number;
  /** Contractor/applicant exactly as the city published it; '' when the city published none. */
  contractor: string;
  projectType: ReturnType<typeof classifyProject>;
  /** Trades this permit's own type/description mentions (roofing, electrical, plumbing, hvac). */
  trades: Trade[];
  priority: CallPriority;
  /** Plain-language reasons to call now, in the contractor's own terms. */
  callReasons: string[];
  /** Freshness of the feed this lead came from, assessed on the batch's newest permit. */
  freshness: 'live' | 'stale' | 'unavailable' | 'unknown';
  /** 'Phone not in public records' is the honest state — shown by the UI when phone is null. */
  owner: FunnelOwner;
  contact: FunnelContact;
  /** Who to ask for: the TDLR license holder where the public file has one, else a CRM
   *  contact matched by name, else all-null ("Decision-maker not in public records"). */
  decisionMaker: DecisionMaker;
  /** The company's funnel stage for this lead, merged in by the route from stored stages. */
  stage: FunnelStage;
  url: string;
}

export interface FunnelFeedSummary {
  id: string;
  name: string;
  status: 'ok' | 'unavailable';
  count: number;
  leads: number;
  latest: string | null;
  freshness: 'live' | 'stale' | 'unavailable' | 'unknown';
  /** 'Last fetched X minutes ago' is derived from this at read time, never stored as text. */
  lastCheckedAt: string;
  message: string;
}

export interface FunnelDerivation {
  leads: FunnelLead[];
  scanned: number;
  excluded: { dead: number; publicOwner: number; duplicate: number };
  feeds: FunnelFeedSummary[];
}

const TRADE_RE: { trade: Trade; re: RegExp }[] = [
  { trade: 'roofing', re: /\broofing\b|\broof\b/ },
  { trade: 'electrical', re: /\belectrical?\b|\belectric\b/ },
  { trade: 'plumbing', re: /\bplumbing\b|\bplumb\b/ },
  { trade: 'hvac', re: /\bmechanical\b|\bhvac\b/ },
  { trade: 'framing', re: /\bframing\b|\bframe\b/ },
  { trade: 'concrete', re: /\bconcrete\b|\bcurb\b/ },
  { trade: 'grading', re: /\bgrading\b|\bsite ?work\b|\bexcavat/ },
];

function detectTrades(p: RawPermit): Trade[] {
  const text = [p.description, p.permitType, p.workClass, p.landUse].join(' ').toLowerCase();
  return TRADE_RE.filter(({ re }) => re.test(text)).map(({ re: _re, trade }) => trade);
}

function daysSince(date: string | null, now: Date): number | null {
  if (!date) return null;
  const ms = now.getTime() - Date.parse(date);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor(ms / DAY_MS));
}

const PRIORITY_RANK: Record<CallPriority, number> = { hot: 0, warm: 1, cool: 2 };

/**
 * Rank raw permits into callable funnel leads. Pure: callers supply the permits and the
 * per-feed freshness (assessed on each feed's newest permit); no network, no storage.
 * Dedupes on source + permit number, drops dead/completed permits and public-entity owners,
 * and ranks hot (issued ≤7 days, no contractor on file) first, then newest first.
 */
export function deriveFunnelLeads(
  permits: RawPermit[],
  now: Date,
  opts: { trades?: Trade[]; maxAgeDays?: number } = {},
): FunnelDerivation {
  const wantedTrades = opts.trades ?? [];
  const maxAgeDays = opts.maxAgeDays ?? 30;
  const seen = new Set<string>();
  const excluded = { dead: 0, publicOwner: 0, duplicate: 0 };
  const leads: FunnelLead[] = [];
  const feedLatest = new Map<string, string>();

  for (const p of permits) {
    const key = `${p.source}:${p.permitNumber || poolPropertyKey(p) || p.address}`;
    if (!p.permitNumber && !p.address) continue;
    if (seen.has(key)) {
      excluded.duplicate += 1;
      continue;
    }
    seen.add(key);
    if (DEAD_STATUS.test(p.status)) {
      excluded.dead += 1;
      continue;
    }
    if (p.contractor && PUBLIC_OWNER.test(p.contractor)) {
      excluded.publicOwner += 1;
      continue;
    }
    const stage = stageOf(p);
    if (stage === 'completed') {
      excluded.dead += 1;
      continue;
    }
    const issuedAt = p.issuedAt ?? p.appliedAt;
    const days = daysSince(issuedAt, now);
    if (days !== null && days > maxAgeDays) continue;
    const trades = detectTrades(p);
    const tradeMatch =
      wantedTrades.length === 0 || trades.some((t) => wantedTrades.includes(t));
    const reasons: string[] = [];
    let priority: CallPriority = 'cool';
    if (days !== null && days <= 7) {
      priority = 'hot';
      reasons.push(`Permit issued ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`} — the owner is deciding now.`);
    } else if (days !== null && days <= 30) {
      priority = 'warm';
      reasons.push(`Permit issued ${days} days ago — still early enough to get in.`);
    } else if (days === null) {
      reasons.push('No permit date on file — call to confirm the job is still open.');
    }
    if (!p.contractor) {
      reasons.push('No contractor on file yet — nobody has this job locked up.');
    } else {
      reasons.push(`Permit names ${p.contractor} — call the owner before the work is awarded.`);
      if (priority === 'hot') priority = 'warm';
    }
    if (tradeMatch && trades.length > 0) {
      reasons.push(`Trade match: ${trades.join(', ')}.`);
    }
    if (p.value > 0) {
      reasons.push(`Listed value $${p.value.toLocaleString('en-US')}.`);
    }
    if (!p.address) {
      reasons.push('No street address published — confirm the site from the permit record.');
      priority = 'cool';
    }
    const latest = p.issuedAt ?? p.appliedAt;
    if (latest) {
      const prev = feedLatest.get(p.source);
      if (!prev || latest > prev) feedLatest.set(p.source, latest);
    }
    leads.push({
      key,
      source: p.source,
      sourceName: p.sourceName,
      permitNumber: p.permitNumber,
      city: p.city,
      address: p.address,
      zip: p.zip,
      description: p.description,
      permitType: p.permitType,
      workClass: p.workClass,
      status: p.status,
      issuedAt: p.issuedAt,
      appliedAt: p.appliedAt,
      daysSince: days,
      value: p.value,
      units: p.units,
      contractor: p.contractor,
      projectType: classifyProject(p),
      trades,
      priority,
      callReasons: reasons,
      freshness: 'unknown',
      owner: { name: null, mailingAddress: null, source: null, vintage: null },
      contact: {
        phone: p.contractorPhone || null,
        phoneSource: p.contractorPhone ? 'permit' : null,
      },
      decisionMaker: { ...EMPTY_DECISION_MAKER },
      stage: 'new',
      url: p.url,
    });
  }

  // Freshness is per-feed, assessed on the batch's newest permit (same rule as freshness.ts:
  // a feed that has not published inside its cadence window is stale, never backfilled).
  for (const lead of leads) {
    const latest = feedLatest.get(lead.source) ?? null;
    lead.freshness = assessFreshness(lead.source, latest, now).status;
  }

  leads.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (b.issuedAt ?? b.appliedAt ?? '').localeCompare(a.issuedAt ?? a.appliedAt ?? '') ||
      b.value - a.value,
  );
  return { leads, scanned: permits.length, excluded, feeds: [] };
}

/** 'Last fetched X minutes ago' — computed at read time from the stored last-checked time. */
export function minutesAgoText(lastCheckedAt: string | null, now: Date): string {
  if (!lastCheckedAt) return 'Not checked yet';
  const ms = now.getTime() - Date.parse(lastCheckedAt);
  if (Number.isNaN(ms) || ms < 0) return 'Checked just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Checked just now';
  if (minutes < 60) return `Checked ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Checked ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Checked ${days} day${days === 1 ? '' : 's'} ago`;
}
