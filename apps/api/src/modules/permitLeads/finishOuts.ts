// Texas Finish-outs: renovations, tenant improvements and interior build-outs as leads for
// flooring, cabinet, countertop and fixture companies. The main permit search treats remodels
// as not-new-construction and cuts them; this view surfaces exactly those permits.
//
// Honest limits, carried into every response:
// - Dallas (and most Texas feeds) publish almost no value or contractor fields on 2026
//   permits, so value is mostly blank here and contractor is often missing. Nothing is
//   invented: a permit with no published value lands in the "value not listed" band.
// - "Still need subcontractors" is an inference only — no contractor named on the permit, or
//   no separate finish-out trade permit observed at the address. Finish trades rarely pull a
//   permit of their own (floors/cabinets/fixtures ride on the parent remodel permit), so an
//   unobserved finish permit never proves the finish work is unawarded.
// - The reel that inspired this quoted a dollar total for Dallas; that number is the
//   creator's claim and is never copied or implied here. Totals below sum only the values
//   the cities actually published in this scan.
import {
  classifyProject,
  isNewConstruction,
  type ProjectType,
  type RawPermit,
} from './engine';
import { assessFreshness } from './freshness';
import { stageOf, tradeEvidence, type LeadStage, type TradeEvidence } from './signals';
import {
  checkCustomFeed,
  fetchCustom,
  fetchers,
  LIVE_SOURCES,
  type SourceFetcherFn,
} from './sources';
import { cleanCityName } from './texas';
import { deriveTradeTiming } from './tradeTiming';

type FetchLike = typeof fetch;
const DAY_MS = 86_400_000;

export type RenovationKind =
  'finish_out' | 'remodel' | 'addition' | 'repair' | 'new_construction' | 'other';

export const RENOVATION_KIND_LABEL: Record<RenovationKind, string> = {
  finish_out: 'Finish-out / tenant improvement',
  remodel: 'Remodel / renovation',
  addition: 'Addition',
  repair: 'Repair / replacement',
  new_construction: 'New construction',
  other: 'Other',
};

const searchableText = (p: RawPermit): string =>
  [p.description, p.permitType, p.workClass, p.landUse].join(' ').toLowerCase();

/**
 * What kind of work a permit describes, for the finish-outs view. Additive: this does not
 * change classifyProject or isNewConstruction, which the main search still uses.
 */
export function classifyRenovation(p: RawPermit): RenovationKind {
  const t = searchableText(p);
  if (
    /finish[ -]?out|tenant improvement|\bti\b|interior (build[ -]?out|finish|alteration|remodel)|build[ -]?out|white[ -]?box|shell (finish|build[ -]?out)|office remodel|retail remodel/.test(
      t,
    )
  )
    return 'finish_out';
  if (/addition|expand|extension/.test(t)) return 'addition';
  if (/remodel|renovat|interior|alteration|kitchen|bath(room)? (remodel|renovation)|conversion/.test(t))
    return 'remodel';
  if (/repair|replace|re-?roof|demo/.test(t)) return 'repair';
  if (isNewConstruction(p)) return 'new_construction';
  return 'other';
}

/** A permit is a finish-out lead when it is a finish-out, remodel or addition — the
 *  renovation work a flooring/cabinet/fixture company can sell into. */
export function isFinishOutLead(p: RawPermit): boolean {
  const kind = classifyRenovation(p);
  return kind === 'finish_out' || kind === 'remodel' || kind === 'addition';
}

// ---- Value bands (published value only; blank stays blank) ----

export const VALUE_BANDS = [
  'under_25k',
  '25k_100k',
  '100k_500k',
  '500k_1m',
  '1m_10m',
  'over_10m',
  'not_listed',
] as const;
export type ValueBand = (typeof VALUE_BANDS)[number];

export const VALUE_BAND_LABEL: Record<ValueBand, string> = {
  under_25k: 'Under $25k',
  '25k_100k': '$25k–$100k',
  '100k_500k': '$100k–$500k',
  '500k_1m': '$500k–$1M',
  '1m_10m': '$1M–$10M',
  over_10m: 'Over $10M',
  not_listed: 'Value not listed',
};

export function valueBandOf(value: number): ValueBand {
  if (!(value > 0)) return 'not_listed';
  if (value < 25_000) return 'under_25k';
  if (value < 100_000) return '25k_100k';
  if (value < 500_000) return '100k_500k';
  if (value < 1_000_000) return '500k_1m';
  if (value <= 10_000_000) return '1m_10m';
  return 'over_10m';
}

// ---- Lead derivation ----

export interface FinishOutLead {
  address: string;
  city: string;
  zip: string;
  source: string;
  sourceName: string;
  permitNumber: string;
  description: string;
  permitType: string;
  status: string;
  issuedAt: string | null;
  appliedAt: string | null;
  /** Published value only; 0 means the city did not publish one (never estimated). */
  value: number;
  valueBand: ValueBand;
  valueBandLabel: string;
  contractor: string;
  contractorPhone: string;
  url: string;
  latitude?: number | null;
  longitude?: number | null;
  projectType: ProjectType;
  renovationKind: RenovationKind;
  renovationKindLabel: string;
  stage: LeadStage;
  /** 'application' = still under city review. */
  underReview: boolean;
  finishTradeEvidence: TradeEvidence;
  /** Inference only: no contractor on file, or no separate finish permit observed. */
  possibleFinishOpening: boolean;
  possibleFinishOpeningNote: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  reasons: string[];
}

const OPENING_NOTE =
  'Inference only: no contractor is named on this permit, or no separate finish-out trade permit was observed at this address. Finish trades rarely pull their own permit, so this does not prove the finish work is unawarded.';

function scoreFinishOut(
  p: RawPermit,
  stage: LeadStage,
  evidence: TradeEvidence,
  now: Date,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (p.value > 0) {
    const v = Math.min(40, Math.round((Math.log10(p.value) - 3) * 10));
    score += Math.max(0, v);
    reasons.push(`Listed value $${Math.round(p.value).toLocaleString('en-US')}`);
  } else {
    reasons.push('Value not listed on the permit');
  }
  if (!p.contractor.trim()) {
    score += 15;
    reasons.push('No contractor named on the permit yet');
  }
  if (stage === 'application') {
    score += 15;
    reasons.push('Still under city review — early enough to get in front of it');
  } else if (stage === 'permitted') {
    score += 10;
    reasons.push('Permit issued');
  } else if (stage === 'planning') {
    score += 8;
    reasons.push('Planning stage');
  }
  if (evidence === 'not_observed') {
    score += 10;
    reasons.push('No separate finish-out trade permit observed at this address (inference only)');
  }
  const date = p.appliedAt ?? p.issuedAt;
  if (date) {
    const ageDays = (now.getTime() - Date.parse(date)) / DAY_MS;
    if (ageDays <= 7) score += 10;
    else if (ageDays <= 30) score += 6;
    else if (ageDays <= 90) score += 3;
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export interface FinishOutDerivation {
  leads: FinishOutLead[];
  permitsScanned: number;
  finishOutPermits: number;
  underReview: number;
  possibleOpenings: number;
  /** Sum of published values only — permits with no published value add nothing. */
  totalListedValue: number;
  byKind: Record<RenovationKind, number>;
  byBand: Record<ValueBand, number>;
  byStage: Record<LeadStage, number>;
}

export interface FinishOutFilters {
  kinds?: RenovationKind[];
  stages?: LeadStage[];
  valueBands?: ValueBand[];
}

/**
 * Build finish-out leads from scanned permits. Pure: callers supply the permits.
 * Completed permits are dropped (the finish work is done). Sort: highest score first,
 * newest permit first within a score.
 */
export function deriveFinishOuts(
  permits: RawPermit[],
  now: Date,
  filters: FinishOutFilters = {},
): FinishOutDerivation {
  const kinds = filters.kinds?.length ? new Set(filters.kinds) : null;
  const stages = filters.stages?.length ? new Set(filters.stages) : null;
  const bands = filters.valueBands?.length ? new Set(filters.valueBands) : null;

  const byKind: Record<RenovationKind, number> = {
    finish_out: 0,
    remodel: 0,
    addition: 0,
    repair: 0,
    new_construction: 0,
    other: 0,
  };
  const byBand: Record<ValueBand, number> = {
    under_25k: 0,
    '25k_100k': 0,
    '100k_500k': 0,
    '500k_1m': 0,
    '1m_10m': 0,
    over_10m: 0,
    not_listed: 0,
  };
  const byStage: Record<LeadStage, number> = {
    planning: 0,
    application: 0,
    permitted: 0,
    completed: 0,
    unknown: 0,
  };

  const leads: FinishOutLead[] = [];
  let finishOutPermits = 0;
  for (const p of permits) {
    const kind = classifyRenovation(p);
    byKind[kind] += 1;
    if (!isFinishOutLead(p)) continue;
    finishOutPermits += 1;
    const stage = stageOf(p);
    if (stage === 'completed') continue;
    const band = valueBandOf(p.value);
    if (kinds && !kinds.has(kind)) continue;
    if (stages && !stages.has(stage)) continue;
    if (bands && !bands.has(band)) continue;
    const evidence = tradeEvidence(p, 'finish_out', permits);
    const { score, reasons } = scoreFinishOut(p, stage, evidence, now);
    const possibleFinishOpening = !p.contractor.trim() || evidence === 'not_observed';
    byBand[band] += 1;
    byStage[stage] += 1;
    leads.push({
      address: p.address,
      city: p.city,
      zip: p.zip,
      source: p.source,
      sourceName: p.sourceName,
      permitNumber: p.permitNumber,
      description: p.description,
      permitType: p.permitType,
      status: p.status,
      issuedAt: p.issuedAt,
      appliedAt: p.appliedAt,
      value: p.value,
      valueBand: band,
      valueBandLabel: VALUE_BAND_LABEL[band],
      contractor: p.contractor,
      contractorPhone: p.contractorPhone,
      url: p.url,
      latitude: p.latitude,
      longitude: p.longitude,
      projectType: classifyProject(p),
      renovationKind: kind,
      renovationKindLabel: RENOVATION_KIND_LABEL[kind],
      stage,
      underReview: stage === 'application',
      finishTradeEvidence: evidence,
      possibleFinishOpening,
      possibleFinishOpeningNote: OPENING_NOTE,
      score,
      grade: score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D',
      reasons,
    });
  }
  leads.sort(
    (a, b) =>
      b.score - a.score ||
      (b.issuedAt ?? b.appliedAt ?? '').localeCompare(a.issuedAt ?? a.appliedAt ?? ''),
  );
  return {
    leads,
    permitsScanned: permits.length,
    finishOutPermits,
    underReview: leads.filter((l) => l.underReview).length,
    possibleOpenings: leads.filter((l) => l.possibleFinishOpening).length,
    totalListedValue: leads.reduce((s, l) => s + l.value, 0),
    byKind,
    byBand,
    byStage,
  };
}

// ---- Fetching renovation permits from the same live feeds ----

export interface FinishOutsInput {
  cities: string[];
  days: number;
  customFeeds: { city: string; url: string }[];
  kinds?: RenovationKind[];
  stages?: LeadStage[];
  valueBands?: ValueBand[];
}

export interface FinishOutsFeed {
  id: string;
  name: string;
  status: 'ok' | 'unavailable' | 'rejected';
  count: number;
  finishOutPermits: number;
  latest: string | null;
  freshness: 'live' | 'stale' | 'unavailable' | 'unknown';
  message: string;
}

export async function searchFinishOuts(
  input: FinishOutsInput,
  deps: {
    fetcher?: FetchLike;
    now?: Date;
    fetchers?: Record<string, SourceFetcherFn>;
    resolve?: Parameters<typeof checkCustomFeed>[1];
  } = {},
) {
  const now = deps.now ?? new Date();
  const fetcher = deps.fetcher ?? fetch;
  const sourceFetchers = deps.fetchers ?? fetchers;
  const since = new Date(now.getTime() - input.days * DAY_MS);
  const wanted = [...new Set(input.cities.map(cleanCityName).filter(Boolean))];
  const wantedLower = new Set(wanted.map((c) => c.toLowerCase()));
  const everyCity = wantedLower.has('all texas');

  const run = async (
    id: string,
    name: string,
    load: () => Promise<RawPermit[]>,
  ): Promise<{ feed: FinishOutsFeed; permits: RawPermit[] }> => {
    try {
      const raw = await load();
      // Same permit can be published more than once in a feed or data refresh.
      const permits = [...new Map(raw.map((p) => [p.source + ':' + p.permitNumber, p])).values()];
      const finishOutPermits = permits.filter(isFinishOutLead).length;
      const latest =
        permits
          .map((p) => p.issuedAt ?? p.appliedAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;
      const freshness = assessFreshness(id, latest, now);
      return {
        feed: {
          id,
          name,
          status: 'ok',
          count: permits.length,
          finishOutPermits,
          latest,
          freshness: permits.length > 0 ? freshness.status : 'unavailable',
          message:
            `${permits.length} permits in the window, ${finishOutPermits} finish-out / remodel.` +
            (permits.length && freshness.status === 'stale' ? ` ${freshness.message}` : ''),
        },
        permits,
      };
    } catch {
      return {
        feed: {
          id,
          name,
          status: 'unavailable',
          count: 0,
          finishOutPermits: 0,
          latest: null,
          freshness: 'unavailable',
          message: 'The city feed did not answer. Try again in a few minutes.',
        },
        permits: [],
      };
    }
  };

  const jobs: Promise<{ feed: FinishOutsFeed; permits: RawPermit[] }>[] = [];
  for (const src of LIVE_SOURCES) {
    const hit = everyCity || src.cities.some((c) => wantedLower.has(c.toLowerCase()));
    if (!hit) continue;
    const runSource = sourceFetchers[src.id];
    if (!runSource) continue;
    jobs.push(
      run(src.id, src.name, async () =>
        (await runSource({ fetch: fetcher, since, now })).filter((p) =>
          src.id === 'collin' ? everyCity || wantedLower.has(p.city.toLowerCase()) : true,
        ),
      ),
    );
  }
  for (const feed of input.customFeeds) {
    const city = cleanCityName(feed.city);
    const url = await checkCustomFeed(feed.url, deps.resolve);
    if (!url) {
      jobs.push(
        Promise.resolve({
          feed: {
            id: 'custom:' + city,
            name: `${city} feed`,
            status: 'rejected' as const,
            count: 0,
            finishOutPermits: 0,
            latest: null,
            freshness: 'unknown' as const,
            message:
              'Use the https "/resource/xxxx-xxxx.json" API link from the city\u2019s open-data permit page.',
          },
          permits: [],
        }),
      );
      continue;
    }
    jobs.push(
      run('custom:' + url.host, `${city} open data (${url.host})`, () =>
        fetchCustom(url, city, since, fetcher),
      ),
    );
  }
  const outcomes = await Promise.all(jobs);
  const all = [
    ...new Map(
      outcomes.flatMap((o) => o.permits).map((p) => [p.source + ':' + p.permitNumber, p]),
    ).values(),
  ];
  const derived = deriveFinishOuts(all, now, {
    kinds: input.kinds,
    stages: input.stages,
    valueBands: input.valueBands,
  });
  const tradeTiming = deriveTradeTiming(all, now);
  return {
    fetchedAt: now.toISOString(),
    window: { since: since.toISOString(), days: input.days },
    summary: {
      permitsScanned: derived.permitsScanned,
      finishOutPermits: derived.finishOutPermits,
      leads: derived.leads.length,
      underReview: derived.underReview,
      possibleOpenings: derived.possibleOpenings,
      totalListedValue: derived.totalListedValue,
      byKind: derived.byKind,
      byBand: derived.byBand,
      byStage: derived.byStage,
    },
    feeds: outcomes.map((o) => o.feed),
    leads: derived.leads.slice(0, 300),
    tradeTiming,
    caveats: [
      'Value is mostly blank: Dallas and most Texas feeds publish almost no value or contractor fields on current permits, so most leads land in "Value not listed". Totals sum only the values the cities actually published — nothing is estimated or invented.',
      '"Possible finish opening" is an inference only: no contractor named on the permit, or no separate finish-out trade permit observed at the address. Finish trades (flooring, cabinets, fixtures) rarely pull a permit of their own, so this never proves the finish work is unawarded.',
      '"Under city review" comes from the permit\u2019s published status and dates (application filed, not yet issued). Permit dates are not construction start-date predictions.',
      'A finish-out is only counted when the city\u2019s own type, description or work class says so (finish-out, tenant improvement, remodel, renovation, interior work, addition). Houston rows are only identifiable when the weekly file\u2019s comments say so.',
      'No dollar total from any video is used here. Every number above comes from the permits actually scanned in this window.',
    ],
  };
}
