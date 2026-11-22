// Builder book: aggregates ranked permits BY builder and prepares per-builder takeoff inputs and
// supplier outreach drafts. Additive companion to buildProfiles() in engine.ts — same grouping key
// (normalizeCompany), same "nothing invented" rule: square footage and stories are only reported
// when the permit text itself states them, and outreach reuses outreachKit() unchanged.
import {
  buildProfiles,
  normalizeCompany,
  outreachKit,
  tradeMatches,
  TRADES,
  type BuilderProfile,
  type OutreachKit,
  type ProjectType,
  type ScoredPermit,
  type Trade,
} from './engine';

const SQFT_PATTERNS: RegExp[] = [
  /([\d,]{3,})\s*(?:sq\.?\s*ft|sqft|square\s*feet|sf)\b/i,
  /\b(?:sq\.?\s*ft|sqft|square\s*feet)\s*(?:of\s*)?([\d,]{3,})/i,
];

/** Square footage stated in permit text, or null. Never estimated. */
export function parseSqFt(text: string): number | null {
  for (const re of SQFT_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const n = Number(m[1]!.replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 100 && n <= 2_000_000) return Math.round(n);
  }
  return null;
}

/** Stories stated in permit text ("2 story", "two-story"), or null. */
export function parseStories(text: string): 1 | 2 | null {
  if (/\b(?:2|two)[-\s]?stor(?:y|ies)\b/i.test(text)) return 2;
  if (/\b(?:1|one|single)[-\s]?stor(?:y|ies)\b/i.test(text)) return 1;
  return null;
}

export interface BuilderBookPermit {
  permitNumber: string;
  address: string;
  city: string;
  value: number;
  issuedAt: string | null;
  appliedAt: string | null;
  description: string;
  projectType: ProjectType;
  url: string;
  score: number;
  grade: ScoredPermit['grade'];
  /** Square footage stated on the permit, or null when the permit does not state it. */
  sqFt: number | null;
  /** Stories stated on the permit, or null. */
  stories: 1 | 2 | null;
  /** Trades (of the existing nine) this permit matches, from tradeMatches(). */
  trades: Trade[];
}

export interface BuilderBookEntry {
  key: string;
  name: string;
  /** City-published phone only; empty when no permit published one. */
  phone: string;
  permitCount: number;
  totalValue: number;
  /** Permits whose text states square footage, and their summed stated sq ft. */
  sqFtPermitCount: number;
  totalSqFt: number;
  cities: string[];
  projectTypes: ProjectType[];
  /** Union of matched trades across this builder's permits. */
  trades: Trade[];
  latestPermitAt: string | null;
  topScore: number;
  averageScore: number;
  gradeCounts: Record<ScoredPermit['grade'], number>;
  intent: string;
  permits: BuilderBookPermit[];
  /** Supplier outreach draft for this builder's top permit (draft-only; a human sends it). */
  outreach: OutreachKit | null;
}

export function permitSqFt(p: ScoredPermit): number | null {
  return parseSqFt([p.description, p.permitType, p.workClass, p.landUse].join(' '));
}

export function permitStories(p: ScoredPermit): 1 | 2 | null {
  return parseStories([p.description, p.permitType, p.workClass, p.landUse].join(' '));
}

export function permitTrades(p: ScoredPermit): Trade[] {
  return TRADES.filter((t) => tradeMatches(t, p.projectType, p));
}

/**
 * Aggregate scored permits by builder. Permits with no contractor named are skipped (they cannot
 * be attributed to a builder without inventing one). Sorted by permit volume, then listed value.
 */
export function buildBuilderBook(
  permits: ScoredPermit[],
  outreach: { trade: Trade; company: string; yourName: string; bookingLink: string },
): BuilderBookEntry[] {
  const groups = new Map<string, ScoredPermit[]>();
  for (const p of permits) {
    if (!p.contractor) continue;
    const key = normalizeCompany(p.contractor);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  // Reuse the existing profile builder for name/phone/intent so the book never disagrees with
  // the Builder profiles section.
  const profiles = new Map<string, BuilderProfile>(
    buildProfiles(permits).map((pr) => [pr.key, pr]),
  );

  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => b.score - a.score);
      const top = sorted[0]!;
      const profile = profiles.get(key);
      const bookPermits: BuilderBookPermit[] = sorted.map((p) => ({
        permitNumber: p.permitNumber,
        address: p.address,
        city: p.city,
        value: p.value,
        issuedAt: p.issuedAt,
        appliedAt: p.appliedAt,
        description: p.description,
        projectType: p.projectType,
        url: p.url,
        score: p.score,
        grade: p.grade,
        sqFt: permitSqFt(p),
        stories: permitStories(p),
        trades: permitTrades(p),
      }));
      const gradeCounts: Record<ScoredPermit['grade'], number> = { A: 0, B: 0, C: 0, D: 0 };
      for (const p of list) gradeCounts[p.grade] += 1;
      const dates = list.map((p) => p.issuedAt ?? p.appliedAt).filter(Boolean) as string[];
      return {
        key,
        name: profile?.name ?? top.contractor,
        phone: profile?.phone ?? '',
        permitCount: list.length,
        totalValue: list.reduce((s, p) => s + p.value, 0),
        sqFtPermitCount: bookPermits.filter((p) => p.sqFt !== null).length,
        totalSqFt: bookPermits.reduce((s, p) => s + (p.sqFt ?? 0), 0),
        cities: [...new Set(list.map((p) => p.city))].slice(0, 8),
        projectTypes: [...new Set(list.map((p) => p.projectType))],
        trades: [...new Set(bookPermits.flatMap((p) => p.trades))],
        latestPermitAt: dates.sort().at(-1) ?? null,
        topScore: top.score,
        averageScore: Math.round(list.reduce((s, p) => s + p.score, 0) / list.length),
        gradeCounts,
        intent: profile?.intent ?? 'Single project in this window',
        permits: bookPermits.slice(0, 25),
        outreach: outreachKit({
          trade: outreach.trade,
          company: outreach.company,
          yourName: outreach.yourName,
          bookingLink: outreach.bookingLink,
          permit: top,
          profile,
        }),
      };
    })
    .sort((a, b) => b.permitCount - a.permitCount || b.totalValue - a.totalValue);
}
