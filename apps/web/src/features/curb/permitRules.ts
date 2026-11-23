/** City permit rule checks (Phase D, item 18) — behind `curb.permit_rules` (off by default,
 * platform-controlled: a company cannot switch it on).
 *
 * Rules here come ONLY from guidance already curated in this repo from city-published
 * resources (see permitDirectory.ts, verified November 2026). Each check cites its source.
 * A city with no curated entry returns "no rules loaded" — rules are never guessed, and a
 * check result is a prompt to confirm with the city, not a legal determination.
 */
import { normalizedCity, VERIFIED_PERMIT_PORTALS } from './permitDirectory';

export type PermitWorkType = 'curb_cut' | 'driveway_approach' | 'sidewalk' | 'right_of_way';

export const WORK_TYPE_LABELS: Record<PermitWorkType, string> = {
  curb_cut: 'Curb cut',
  driveway_approach: 'Driveway approach',
  sidewalk: 'Sidewalk',
  right_of_way: 'Right-of-way work',
};

export interface PermitRuleCheck {
  id: string;
  workTypes: readonly PermitWorkType[];
  title: string;
  detail: string;
  /** City-published source for this check (from the curated directory). */
  sourceUrl: string;
  portalName: string;
}

interface CityRuleSet {
  city: string;
  state: string;
  checks: readonly PermitRuleCheck[];
}

const ALL_WORK: readonly PermitWorkType[] = ['curb_cut', 'driveway_approach', 'sidewalk', 'right_of_way'];
const ROW_WORK: readonly PermitWorkType[] = ['curb_cut', 'driveway_approach', 'right_of_way'];

/** Hand-authored from the guidance text in permitDirectory.ts; sourceUrl is that entry's
 * city-published source. Add a city only with a verified portal entry. */
export const CITY_RULE_SETS: readonly CityRuleSet[] = [
  {
    city: 'Fort Worth', state: 'TX',
    checks: [
      {
        id: 'fw-parkway', workTypes: ALL_WORK,
        title: 'Parkway Permit generally required',
        detail: 'Curbs, gutters, drive approaches and sidewalks generally require a Parkway Permit through the city Accela portal.',
        sourceUrl: 'https://www.fortworthtexas.gov/departments/development-services/infrastructure-division',
        portalName: 'Fort Worth Parkway / Accela permits',
      },
      {
        id: 'fw-separate-approvals', workTypes: ROW_WORK,
        title: 'Check separate Street Use / TxDOT approvals',
        detail: 'Confirm whether a separate Street Use or TxDOT approval applies to this location before starting.',
        sourceUrl: 'https://www.fortworthtexas.gov/departments/development-services/infrastructure-division',
        portalName: 'Fort Worth Parkway / Accela permits',
      },
    ],
  },
  {
    city: 'Carrollton', state: 'TX',
    checks: [
      {
        id: 'car-row', workTypes: ROW_WORK,
        title: 'Confirm separate right-of-way approval',
        detail: 'Apply through CityServe (Building Department). Confirm whether a separate right-of-way approval is needed for this work.',
        sourceUrl: 'https://www.cityofcarrollton.com/about-us/stay-connected/cityserve-permits-inspections',
        portalName: 'Carrollton CityServe',
      },
    ],
  },
  {
    city: 'Dallas', state: 'TX',
    checks: [
      {
        id: 'dal-department', workTypes: ALL_WORK,
        title: 'Choose Building or Public Works',
        detail: 'In DallasNow (Accela), choose Building or Public Works as appropriate for the work type; use Search Records/Applications to check submitted records.',
        sourceUrl: 'https://aca-prod.accela.com/dallastx/default.aspx',
        portalName: 'DallasNow (Accela)',
      },
    ],
  },
  {
    city: 'Austin', state: 'TX',
    checks: [
      {
        id: 'aus-row', workTypes: ROW_WORK,
        title: 'ROW / Special Events application path',
        detail: 'In Austin Build + Connect, choose Apply for ROW/Special Events for right-of-way work.',
        sourceUrl: 'https://www.austintexas.gov/development-services/austin-build-connect-abc',
        portalName: 'Austin Build + Connect',
      },
    ],
  },
  {
    city: 'San Antonio', state: 'TX',
    checks: [
      {
        id: 'sa-row', workTypes: ROW_WORK,
        title: 'Some ROW permits use a separate process',
        detail: 'Apply through BuildSA Online Services. Some right-of-way permits may have a separate process — confirm before applying.',
        sourceUrl: 'https://www.sa.gov/Directory/Departments/DSD/BuildSA',
        portalName: 'BuildSA Online Services',
      },
    ],
  },
  {
    city: 'Plano', state: 'TX',
    checks: [
      {
        id: 'pla-row', workTypes: ROW_WORK,
        title: 'Confirm separate public ROW requirements',
        detail: 'Apply or search in Plano eTRAKiT. Confirm separate public right-of-way requirements with the city.',
        sourceUrl: 'https://www.plano.gov/city-services',
        portalName: 'Plano eTRAKiT',
      },
    ],
  },
  {
    city: 'Arlington', state: 'TX',
    checks: [
      {
        id: 'arl-type', workTypes: ALL_WORK,
        title: 'Confirm the appropriate permit type first',
        detail: 'Use Arlington Permits to apply or check status; confirm the appropriate permit type before curb work.',
        sourceUrl: 'https://www.arlingtontx.gov/City-Services/Permits',
        portalName: 'Arlington Permits',
      },
    ],
  },
  {
    city: 'Frisco', state: 'TX',
    checks: [
      {
        id: 'fri-row', workTypes: ROW_WORK,
        title: 'Public Works ROW may need a different application',
        detail: 'Submit plans with Plans & Permits and check status in eTRAKiT. Public Works ROW projects may require a different application.',
        sourceUrl: 'https://www.friscotexas.gov/395/Building-Inspections',
        portalName: 'Frisco Plans & Permits',
      },
    ],
  },
  {
    city: 'Irving', state: 'TX',
    checks: [
      {
        id: 'irv-type', workTypes: ROW_WORK,
        title: 'Confirm curb / right-of-way permit type',
        detail: 'Irving uses MGO Connect to apply, pay fees and review results. Confirm any curb/right-of-way permit type with the city.',
        sourceUrl: 'https://irvingtx.gov/index.php?section=Online-Permit-Instructions',
        portalName: 'Irving My Government Online (MGO)',
      },
    ],
  },
  {
    city: 'McKinney', state: 'TX',
    checks: [
      {
        id: 'mck-roway', workTypes: ROW_WORK,
        title: 'ROWAY covers right-of-way work',
        detail: 'ROWAY covers right-of-way work. Building permits use a different city portal; confirm the correct department.',
        sourceUrl: 'https://www.mckinneytexas.org/165/Permits',
        portalName: 'McKinney ROWAY (right of way)',
      },
    ],
  },
];

export type PermitRuleResult =
  | { status: 'no_rules_loaded'; city: string; state: string; message: string }
  | {
      status: 'checks_found'; city: string; state: string;
      portalName: string; applyUrl: string; checks: PermitRuleCheck[];
      message: string;
    };

/** Every rule set must correspond to a verified portal entry — enforced in tests. */
export function ruleSetsMatchDirectory(): boolean {
  return CITY_RULE_SETS.every((set) =>
    VERIFIED_PERMIT_PORTALS.some(
      (p) => p.state === set.state && normalizedCity(p.city) === normalizedCity(set.city)));
}

export function checkPermitRules(
  cityInput: string,
  stateInput: string,
  workType: PermitWorkType,
): PermitRuleResult {
  const city = cityInput.trim().replace(/\s+/g, ' ');
  const state = stateInput.trim().toUpperCase();
  const set = CITY_RULE_SETS.find(
    (s) => s.state === state && normalizedCity(s.city) === normalizedCity(city));
  if (!set) {
    return {
      status: 'no_rules_loaded', city, state,
      message: `No permit rules are loaded for ${city || 'this city'}, ${state || 'this state'}. Confirm requirements with the city or county permitting office.`,
    };
  }
  const portal = VERIFIED_PERMIT_PORTALS.find(
    (p) => p.state === set.state && normalizedCity(p.city) === normalizedCity(set.city));
  const checks = set.checks.filter((c) => c.workTypes.includes(workType));
  return {
    status: 'checks_found',
    city: set.city, state: set.state,
    portalName: portal?.name ?? set.checks[0]?.portalName ?? '',
    applyUrl: portal?.applyUrl ?? '',
    checks,
    message: checks.length === 0
      ? `Rules are loaded for ${set.city}, but none are specific to ${WORK_TYPE_LABELS[workType].toLowerCase()}. Confirm with the city before starting.`
      : 'Confirm each check with the city before starting work. This is guidance from city-published sources, not a legal determination.',
  };
}
