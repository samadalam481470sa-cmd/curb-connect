// Texas permit job search: turns public building-permit records into ranked, early-stage jobs,
// builder profiles and ready-to-send outreach. Every number comes from a permit record; nothing is
// invented. Contacts are only what the city published; the rest is a lookup link to the state.
import { DISTANCE_LABEL, distanceTier, findTexasCity, type TexasCity } from './texas';

export const TRADES = [
  'grading',
  'concrete',
  'roofing',
  'materials',
  'framing',
  'hvac',
  'electrical',
  'plumbing',
  'general',
] as const;
export type Trade = (typeof TRADES)[number];

export const PROJECT_TYPES = [
  'single_family',
  'townhome',
  'multifamily',
  'cottage',
  'site_work',
  'commercial',
  'other',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const TRADE_LABEL: Record<Trade, string> = {
  grading: 'Grading and site work',
  concrete: 'Concrete and curb cutting',
  roofing: 'Roofing',
  materials: 'Building materials supply',
  framing: 'Framing and lumber',
  hvac: 'HVAC',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  general: 'General subcontracting',
};
export const PROJECT_LABEL: Record<ProjectType, string> = {
  single_family: 'Single-family home',
  townhome: 'Townhome',
  multifamily: 'Multifamily',
  cottage: 'Cottage / ADU',
  site_work: 'Land development / site work',
  commercial: 'Commercial',
  other: 'Other',
};

export interface RawPermit {
  source: string;
  sourceName: string;
  permitNumber: string;
  city: string;
  address: string;
  zip: string;
  description: string;
  permitType: string;
  workClass: string;
  landUse: string;
  status: string;
  issuedAt: string | null;
  appliedAt: string | null;
  value: number;
  units: number;
  contractor: string;
  contractorPhone: string;
  latitude?: number | null;
  longitude?: number | null;
  url: string;
}

export interface ScoredPermit extends RawPermit {
  projectType: ProjectType;
  newConstruction: boolean;
  earlyStage: boolean;
  contractorAssigned: boolean;
  tradeMatch: boolean;
  distanceTier: 0 | 1 | 2 | 3;
  distanceLabel: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  reasons: string[];
  excludedReason: string | null;
}

const text = (p: RawPermit) =>
  [p.description, p.permitType, p.workClass, p.landUse].join(' ').toLowerCase();

export function classifyProject(p: RawPermit): ProjectType {
  const t = text(p);
  if (/town ?home|town ?house|rowhouse/.test(t)) return 'townhome';
  if (/duplex|triplex|fourplex|four-plex|multi-?family|apartment|condo/.test(t) || p.units >= 3)
    return 'multifamily';
  if (/cottage|\badu\b|accessory dwelling|casita|tiny home/.test(t)) return 'cottage';
  if (
    /grading|site ?work|site ?plan|plat review|preliminary plat|earthwork|land development|subdivision|paving|infrastructure|excavat|utility install|detention|pad prep/.test(
      t,
    )
  )
    return 'site_work';
  if (
    /single[- ]family|\bsfr\b|\bsfd\b|one family|1 family|residential new|new residence|dwelling/.test(
      t,
    )
  )
    return 'single_family';
  if (
    /warehouse|retail|office|commercial|industrial|restaurant|shell|hotel|church|school|medical|logistics|distribution/.test(
      t,
    )
  )
    return 'commercial';
  return 'other';
}

export function isNewConstruction(p: RawPermit): boolean {
  const t = text(p);
  if (/site ?plan|preliminary plat|plat review|pre.?application|land development/i.test(
    [p.permitType, p.workClass, p.status].join(' '))) return true;
  if (
    /remodel|repair|alteration|interior|demo|replace|re-?roof|finish out|tenant improvement|sign|fence|pool|solar|irrigation|temporary/.test(
      t,
    )
  )
    return false;
  return /\bnew\b|new construction|construct|shell|foundation|grading|site ?work|site ?plan|subdivision|addition/.test(
    t,
  );
}

/** Which permits a trade can sell into. */
export function tradeMatches(trade: Trade, type: ProjectType, p: RawPermit): boolean {
  const t = text(p);
  switch (trade) {
    case 'grading':
      return (
        type === 'site_work' ||
        ((type === 'commercial' || type === 'multifamily') && isNewConstruction(p))
      );
    case 'concrete':
      return (
        isNewConstruction(p) ||
        /concrete|flatwork|driveway|sidewalk|curb|slab|foundation|approach/.test(t)
      );
    case 'roofing':
      return /roof/.test(t) || (isNewConstruction(p) && type !== 'site_work');
    case 'materials':
    case 'framing':
      return (
        isNewConstruction(p) &&
        ['single_family', 'townhome', 'multifamily', 'cottage', 'commercial'].includes(type)
      );
    case 'hvac':
      return (
        /hvac|mechanical|air condition|furnace|heat pump/.test(t) ||
        (isNewConstruction(p) && type !== 'site_work')
      );
    case 'electrical':
      return /electric/.test(t) || (isNewConstruction(p) && type !== 'site_work');
    case 'plumbing':
      return /plumb|water|sewer|gas line/.test(t) || (isNewConstruction(p) && type !== 'site_work');
    case 'general':
      return true;
  }
}

/** Public owners that rarely hire outside trades from a cold call; on by default, user can turn off. */
const PUBLIC_OWNER =
  /\b(city of|county of|county\b|\bisd\b|independent school|state of texas|txdot|university of|housing authority)\b/i;

export function normalizeCompany(name: string): string {
  return name
    .toUpperCase()
    .replace(/\d{3}[)\-. ]*\d{3}[-. ]?\d{4}.*$/, '')
    .replace(/\s\d+\s.*$/, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ScoreOptions {
  trade: Trade;
  projectTypes: ProjectType[];
  home: TexasCity;
  exclude: string[];
  skipPublicOwners: boolean;
  earlyOnly: boolean;
  now: Date;
}

export function scorePermit(p: RawPermit, o: ScoreOptions): ScoredPermit {
  const projectType = classifyProject(p);
  const newConstruction = isNewConstruction(p);
  const contractorAssigned = p.contractor.trim().length > 0;
  const tradeMatch = tradeMatches(o.trade, projectType, p);
  const tier = distanceTier(o.home, findTexasCity(p.city));
  const earlyStage =
    newConstruction &&
    (projectType === 'site_work' ||
      /grading|foundation|site|shell|subdivision|new/.test(text(p))) &&
    !/final|complete|closed|certificate of occupancy|\bco\b issued/i.test(p.status);
  const reasons: string[] = [];
  let score = 0;
  if (p.value > 0) {
    const v = Math.min(40, Math.round((Math.log10(p.value) - 3) * 10));
    score += Math.max(0, v);
    reasons.push(`Listed value $${Math.round(p.value).toLocaleString('en-US')}`);
  }
  if (earlyStage) {
    score += 25;
    reasons.push('Early stage: new construction, work not finished');
  }
  if (!contractorAssigned) {
    score += 10;
    reasons.push('No contractor named on the permit yet');
  }
  if (tradeMatch) {
    score += 15;
    reasons.push(`Fits ${TRADE_LABEL[o.trade].toLowerCase()}`);
  }
  score += [10, 7, 4, 0][tier] ?? 0;
  reasons.push(DISTANCE_LABEL[tier]);
  const date = p.appliedAt ?? p.issuedAt;
  if (date) {
    const ageDays = (o.now.getTime() - Date.parse(date)) / 86_400_000;
    if (ageDays <= 7) score += 10;
    else if (ageDays <= 30) score += 6;
    else if (ageDays <= 90) score += 3;
  }
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';

  let excludedReason: string | null = null;
  const who = `${p.contractor} ${p.description}`;
  const hit = o.exclude.find((name) => name && who.toLowerCase().includes(name.toLowerCase()));
  if (hit) excludedReason = `On your skip list (${hit})`;
  else if (o.skipPublicOwners && PUBLIC_OWNER.test(who)) excludedReason = 'Public owner';
  else if (o.projectTypes.length && !o.projectTypes.includes(projectType))
    excludedReason = `Not a project type you picked (${PROJECT_LABEL[projectType]})`;
  else if (!tradeMatch) excludedReason = `Not ${TRADE_LABEL[o.trade].toLowerCase()} work`;
  else if (o.earlyOnly && !earlyStage) excludedReason = 'Past the early stage';

  return {
    ...p,
    projectType,
    newConstruction,
    earlyStage,
    contractorAssigned,
    tradeMatch,
    distanceTier: tier,
    distanceLabel: DISTANCE_LABEL[tier],
    score,
    grade,
    reasons,
    excludedReason,
  };
}

const MATERIALS: Record<Trade, Partial<Record<ProjectType, string[]>> & { default: string[] }> = {
  grading: {
    site_work: [
      'Mass grading and cut/fill',
      'Erosion control and silt fence',
      'Dust control and water truck',
      'Detention pond shaping',
      'Building pad prep and compaction testing',
    ],
    default: ['Building pad prep', 'Site clearing', 'Erosion control', 'Fine grading for flatwork'],
  },
  concrete: {
    site_work: ['Curb and gutter', 'Street paving', 'Sidewalks and ADA ramps', 'Storm inlets'],
    commercial: [
      'Foundation and slab',
      'Parking lot paving',
      'Curb cuts and approaches',
      'Dumpster pads',
    ],
    default: ['Slab foundation', 'Driveway and approach', 'Sidewalk', 'Curb cut', 'Patio flatwork'],
  },
  roofing: {
    multifamily: [
      'Roof deck and underlayment',
      'Shingle or metal roofing per building',
      'Gutters and downspouts',
    ],
    commercial: ['TPO or modified bitumen system', 'Insulation board', 'Flashing and edge metal'],
    default: [
      'Architectural shingles',
      'Underlayment and ice/water shield',
      'Ridge vents',
      'Drip edge and flashing',
    ],
  },
  materials: {
    townhome: [
      'Framing lumber packages per unit',
      'Party-wall fire assemblies',
      'Sheathing and house wrap',
      'Windows and exterior doors',
      'Roofing and siding',
    ],
    multifamily: [
      'Framing lumber and trusses',
      'Fire-rated assemblies',
      'Windows and doors',
      'Drywall',
    ],
    commercial: ['Steel and rebar', 'Concrete', 'Storefront glazing', 'Roofing system'],
    default: [
      'Framing lumber and trusses',
      'Sheathing and house wrap',
      'Windows and doors',
      'Roofing',
      'Drywall and insulation',
    ],
  },
  framing: {
    default: ['Wall framing', 'Floor and roof trusses', 'Sheathing', 'Hardware and connectors'],
  },
  hvac: {
    default: ['Split systems per unit', 'Ductwork', 'Thermostats', 'Ventilation and exhaust'],
  },
  electrical: {
    default: [
      'Service and panel',
      'Rough-in wiring',
      'Fixtures and devices',
      'Temporary power pole',
    ],
  },
  plumbing: {
    default: ['Underground rough-in', 'Water and sewer taps', 'Fixtures', 'Water heaters'],
  },
  general: { default: ['Scope depends on your services'] },
};

export function materialsFor(trade: Trade, type: ProjectType): string[] {
  const table = MATERIALS[trade];
  return table[type] ?? table.default;
}

export interface BuilderProfile {
  key: string;
  name: string;
  phone: string;
  permitCount: number;
  totalValue: number;
  cities: string[];
  projectTypes: ProjectType[];
  latestPermitAt: string | null;
  topScore: number;
  grade: ScoredPermit['grade'];
  intent: string;
  permits: Pick<
    ScoredPermit,
    | 'permitNumber'
    | 'address'
    | 'city'
    | 'value'
    | 'issuedAt'
    | 'appliedAt'
    | 'description'
    | 'projectType'
    | 'url'
    | 'score'
  >[];
}

export function buildProfiles(permits: ScoredPermit[]): BuilderProfile[] {
  const groups = new Map<string, ScoredPermit[]>();
  for (const p of permits) {
    if (!p.contractor) continue;
    const key = normalizeCompany(p.contractor);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => b.score - a.score);
      const top = sorted[0]!;
      const totalValue = list.reduce((sum, p) => sum + p.value, 0);
      const dates = list.map((p) => p.issuedAt ?? p.appliedAt).filter(Boolean) as string[];
      const n = list.length;
      const intent =
        n >= 10
          ? 'High volume: pulling permits every week'
          : n >= 4
            ? 'Steady builder: several active projects'
            : n >= 2
              ? 'Repeat builder: more than one project'
              : 'Single project in this window';
      return {
        key,
        name: top.contractor.replace(/\s\d+\s.*$/, '').slice(0, 120) || key,
        phone: list.find((p) => p.contractorPhone)?.contractorPhone ?? '',
        permitCount: n,
        totalValue,
        cities: [...new Set(list.map((p) => p.city))].slice(0, 8),
        projectTypes: [...new Set(list.map((p) => p.projectType))],
        latestPermitAt: dates.sort().at(-1) ?? null,
        topScore: top.score,
        grade: top.grade,
        intent,
        permits: sorted.slice(0, 25).map((p) => ({
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
        })),
      };
    })
    .sort((a, b) => b.topScore - a.topScore || b.totalValue - a.totalValue);
}

export interface OutreachKit {
  forKey: string;
  materials: string[];
  emails: { label: string; subject: string; body: string }[];
  callOpener: string;
  followUps: { day: number; channel: 'email' | 'call'; message: string }[];
  pitchDeck: { title: string; points: string[] }[];
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export function outreachKit(input: {
  trade: Trade;
  company: string;
  yourName: string;
  bookingLink: string;
  permit: ScoredPermit;
  profile?: BuilderProfile;
}): OutreachKit {
  const { trade, permit: p } = input;
  const you = input.company || 'our team';
  const signer = input.yourName || 'Your name';
  const place = `${p.address}${p.city ? ', ' + p.city : ''}`;
  const builder = input.profile?.name || p.contractor || 'the owner of record';
  const materials = materialsFor(trade, p.projectType);
  const scope = TRADE_LABEL[trade].toLowerCase();
  const book = input.bookingLink ? `\n\nPick a time here: ${input.bookingLink}` : '';
  const volume =
    input.profile && input.profile.permitCount > 1
      ? ` I also saw ${input.profile.permitCount} permits from your team in this period.`
      : '';
  const valueLine = p.value > 0 ? ` (listed at ${money(p.value)})` : '';
  return {
    forKey: p.source + ':' + p.permitNumber,
    materials,
    emails: [
      {
        label: 'Timing',
        subject: `${scope} for ${p.address}`,
        body: `Hi ${builder} team,\n\nI saw permit ${p.permitNumber} for ${place}${valueLine}.${volume} We handle ${scope} in ${p.city || 'your area'} and can be ready before the pad work starts.\n\nFor this project we would cover: ${materials.slice(0, 4).join(', ')}.\n\nCan I send a quick price this week?${book}\n\n${signer}\n${you}`,
      },
      {
        label: 'Proof and price',
        subject: `Quote ready for permit ${p.permitNumber}`,
        body: `Hi ${builder} team,\n\nWe priced ${PROJECT_LABEL[p.projectType].toLowerCase()} work like ${place} recently. We can give you a firm number within 48 hours from your plans.\n\nWhat we include: ${materials.join(', ')}.\n\nWho handles ${scope} buying for this job?${book}\n\n${signer}\n${you}`,
      },
      {
        label: 'Short nudge',
        subject: `Still open on ${p.address}?`,
        body: `Hi ${builder} team,\n\nChecking in on ${place}. If ${scope} is still open, we have crew time in the next few weeks. A reply with "send price" is enough.${book}\n\n${signer}\n${you}`,
      },
    ],
    callOpener: `Hi, this is ${signer} with ${you}. I'm calling about your permit at ${place}. We do ${scope} in ${p.city || 'the area'}. Who decides on ${scope} for that job?`,
    followUps: [
      { day: 0, channel: 'email', message: 'Send the "Timing" email.' },
      {
        day: 2,
        channel: 'call',
        message: 'Call with the opener. Leave a short voicemail if no answer.',
      },
      { day: 5, channel: 'email', message: 'Send the "Proof and price" email.' },
      { day: 10, channel: 'email', message: 'Send the "Short nudge" email, then stop.' },
    ],
    pitchDeck: [
      {
        title: `${p.address} — ${PROJECT_LABEL[p.projectType]}`,
        points: [
          `Permit ${p.permitNumber}`,
          p.value > 0 ? `Listed value ${money(p.value)}` : 'Value not listed on the permit',
          `Status: ${p.status || 'not listed'}`,
        ],
      },
      {
        title: `About ${builder}`,
        points: input.profile
          ? [
              `${input.profile.permitCount} permits in this search window`,
              `${money(input.profile.totalValue)} in listed value`,
              `Active in ${input.profile.cities.join(', ')}`,
              input.profile.intent,
            ]
          : ['No other permits found for this name in the window'],
      },
      { title: `What ${you} brings`, points: materials },
      {
        title: 'Next step',
        points: [
          'Send plans or the site address',
          'Get a firm price within 48 hours',
          input.bookingLink ? `Book: ${input.bookingLink}` : 'Reply to schedule a site visit',
        ],
      },
    ],
  };
}

export function videoScript(input: {
  trade: Trade;
  totalValue: number;
  qualified: number;
  checked: number;
  cities: string[];
  top: ScoredPermit | undefined;
  skippedNames: string[];
}): { onScreen: string[]; narration: string } {
  const top = input.top;
  const where =
    input.cities.length > 3 ? `${input.cities.length} Texas cities` : input.cities.join(', ');
  const onScreen = [
    `${money(input.totalValue)} in permits`,
    `${input.qualified} jobs for ${TRADE_LABEL[input.trade].toLowerCase()}`,
    top ? `#1: ${top.address}, ${top.city}` : 'No top job yet',
  ];
  const skipped = input.skippedNames.length
    ? ` It checked ${input.checked} permits and cut ${input.skippedNames.slice(0, 3).join(', ')} and others that did not fit.`
    : ` It checked ${input.checked} permits.`;
  return {
    onScreen,
    narration:
      `Field Pro found ${money(input.totalValue)} in building permits across ${where}.` +
      ` ${input.qualified} of them fit ${TRADE_LABEL[input.trade].toLowerCase()}.` +
      (top
        ? ` First on the list is ${top.address} in ${top.city}${top.contractor ? `, with ${top.contractor.replace(/\s\d+\s.*$/, '')}` : ''}.`
        : '') +
      skipped +
      ' The permit comes before the pad. Your calls go out before the builder hires a crew.',
  };
}
