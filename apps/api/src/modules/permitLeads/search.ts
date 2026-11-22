import {
  buildProfiles,
  normalizeCompany,
  outreachKit,
  scorePermit,
  videoScript,
  type ProjectType,
  type RawPermit,
  type ScoredPermit,
  type Trade,
} from './engine';
import {
  checkCustomFeed,
  fetchAustin,
  fetchCollin,
  fetchCustom,
  fetchDallas,
  fetchDenton,
  fetchFortWorth,
  LIVE_SOURCES,
  type FeedResult,
} from './sources';
import { parsePlainRule, stageOf, tradeEvidence, type LeadStage } from './signals';
import { cleanCityName, findTexasCity, officialLookupLinks } from './texas';

export interface SearchInput {
  trade: Trade;
  projectTypes: ProjectType[];
  cities: string[];
  homeCity: string;
  days: number;
  exclude: string[];
  skipPublicOwners: boolean;
  earlyOnly: boolean;
  company: string;
  yourName: string;
  bookingLink: string;
  customFeeds: { city: string; url: string }[];
  minValue?: number;
  rule?: string;
  stages?: LeadStage[];
}

type FetchLike = typeof fetch;

export async function searchTexasPermits(
  input: SearchInput,
  deps: { fetcher?: FetchLike; now?: Date; resolve?: Parameters<typeof checkCustomFeed>[1] } = {},
) {
  const now = deps.now ?? new Date();
  const rule = parsePlainRule(input.rule ?? '');
  const minimumValue = Math.max(input.minValue ?? 0, rule.minimumValue);
  const selectedStages = input.stages ?? [];
  const fetcher = deps.fetcher ?? fetch;
  const since = new Date(now.getTime() - input.days * 86_400_000);
  const wanted = [...new Set(input.cities.map(cleanCityName).filter(Boolean))];
  const wantedLower = new Set(wanted.map((c) => c.toLowerCase()));
  const everyCity = wantedLower.has('all texas');
  const home = findTexasCity(input.homeCity);

  const jobs: Promise<FeedResult>[] = [];
  const run = async (
    id: string,
    name: string,
    load: () => Promise<RawPermit[]>,
  ): Promise<FeedResult> => {
    try {
      const permits = await load();
      const latest =
        permits
          .map((p) => p.issuedAt ?? p.appliedAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;
      return {
        id,
        name,
        status: 'ok',
        count: permits.length,
        latest,
        permits,
        message: permits.length
          ? `${permits.length} permits in the window.`
          : 'The feed answered but has no permits in this window. The city may not have published recent weeks yet.',
      };
    } catch {
      return {
        id,
        name,
        status: 'unavailable',
        count: 0,
        latest: null,
        permits: [],
        message: 'The city feed did not answer. Try again in a few minutes.',
      };
    }
  };
  const covered = new Set<string>();
  for (const src of LIVE_SOURCES) {
    const hit = everyCity || src.cities.some((c) => wantedLower.has(c.toLowerCase()));
    if (!hit) continue;
    src.cities.forEach((c) => covered.add(c.toLowerCase()));
    if (src.id === 'austin') jobs.push(run(src.id, src.name, () => fetchAustin(since, fetcher)));
    if (src.id === 'collin')
      jobs.push(
        run(src.id, src.name, async () =>
          (await fetchCollin(since, now, fetcher)).filter(
            (p) => everyCity || wantedLower.has(p.city.toLowerCase()),
          ),
        ),
      );
    if (src.id === 'dallas')
      jobs.push(run(src.id, src.name, () => fetchDallas(since, now, fetcher)));
    if (src.id === 'fortworth')
      jobs.push(run(src.id, src.name, () => fetchFortWorth(since, fetcher)));
    if (src.id === 'denton')
      jobs.push(run(src.id, src.name, () => fetchDenton(since, fetcher)));
  }
  for (const feed of input.customFeeds) {
    const city = cleanCityName(feed.city);
    const url = await checkCustomFeed(feed.url, deps.resolve);
    if (!url) {
      jobs.push(
        Promise.resolve({
          id: 'custom:' + city,
          name: `${city} feed`,
          status: 'rejected',
          count: 0,
          latest: null,
          permits: [],
          message:
            'Use the https "/resource/xxxx-xxxx.json" API link from the city\'s open-data permit page.',
        }),
      );
      continue;
    }
    covered.add(city.toLowerCase());
    jobs.push(
      run('custom:' + url.host, `${city} open data (${url.host})`, () =>
        fetchCustom(url, city, since, fetcher),
      ),
    );
  }
  const feeds = await Promise.all(jobs);

  // Same permit can be published more than once in a feed or data refresh.
  const all = [...new Map(
    feeds.flatMap((f) => f.permits).map((p) => [p.source + ':' + p.permitNumber, p]),
  ).values()];
  const scored = all.map((p) => {
    const scoredPermit = scorePermit(p, {
      trade: input.trade,
      projectTypes: input.projectTypes,
      home,
      exclude: input.exclude,
      skipPublicOwners: input.skipPublicOwners,
      earlyOnly: input.earlyOnly,
      now,
    });
    const stage = stageOf(p);
    const evidence = tradeEvidence(p, input.trade, all);
    let excludedReason = scoredPermit.excludedReason;
    if (!excludedReason && minimumValue && p.value < minimumValue)
      excludedReason = 'Below minimum published value or value unavailable';
    if (!excludedReason && rule.projectTypes.length &&
        !rule.projectTypes.includes(scoredPermit.projectType))
      excludedReason = 'Outside plain-language project type filter';
    if (!excludedReason && selectedStages.length && !selectedStages.includes(stage))
      excludedReason = 'Outside project stage filter';
    return {
      ...scoredPermit,
      stage,
      tradeEvidence: evidence,
      possibleTradeOpening: Boolean(scoredPermit.contractorAssigned && evidence === 'not_observed'),
      excludedReason,
    };
  });
  const qualified = scored.filter((p) => !p.excludedReason).sort((a, b) => b.score - a.score);
  const excluded = scored.filter((p) => p.excludedReason);
  const skippedCompanies = [
    ...new Set(excluded.filter((p) => p.contractor && p.newConstruction).map((p) => p.contractor)),
  ].slice(0, 12);
  const totalValue = qualified.reduce((s, p) => s + p.value, 0);
  const profiles = buildProfiles(qualified).slice(0, 100);
  const byKey = new Map(profiles.map((pr) => [pr.key, pr]));
  const keyOf = (p: ScoredPermit) => normalizeCompany(p.contractor);
  const kits = qualified.slice(0, 25).map((p) =>
    outreachKit({
      trade: input.trade,
      company: input.company,
      yourName: input.yourName,
      bookingLink: input.bookingLink,
      permit: p,
      profile: byKey.get(keyOf(p)),
    }),
  );
  const excludedCounts: Record<string, number> = {};
  for (const p of excluded) {
    const k = p.excludedReason!.replace(/\s*\(.*\)$/, '');
    excludedCounts[k] = (excludedCounts[k] ?? 0) + 1;
  }

  const noFeed = everyCity
    ? []
    : wanted.filter((c) => !covered.has(c.toLowerCase()) && c.toLowerCase() !== 'all texas');
  return {
    fetchedAt: now.toISOString(),
    appliedFilters: {
      minimumValue,
      stages: selectedStages,
      ruleInterpretation: rule.interpreted,
      note: 'An unobserved trade permit is not proof a subcontractor has not been hired. City-level sources do not cover every county jurisdiction.',
    },
    window: { since: since.toISOString(), days: input.days },
    home: { ...home },
    summary: {
      checked: scored.length,
      qualified: qualified.length,
      totalValue,
      builders: profiles.length,
      gradeA: qualified.filter((p) => p.grade === 'A').length,
      possibleTradeOpenings: qualified.filter((p) => p.possibleTradeOpening).length,
      planningSignals: qualified.filter((p) => p.stage === 'planning').length,
      excluded: excludedCounts,
      skippedCompanies,
    },
    feeds: feeds.map(({ permits: _p, ...f }) => f),
    leads: qualified.slice(0, 300),
    topLeads: qualified.slice(0, 20),
    profiles,
    kits,
    video: videoScript({
      trade: input.trade,
      totalValue,
      qualified: qualified.length,
      checked: scored.length,
      cities: [...new Set(qualified.map((p) => p.city))],
      top: qualified[0],
      skippedNames: skippedCompanies,
    }),
    citiesWithoutFeed: noFeed.map((name) => {
      const city = findTexasCity(name);
      return { ...city, links: officialLookupLinks(city) };
    }),
  };
}
