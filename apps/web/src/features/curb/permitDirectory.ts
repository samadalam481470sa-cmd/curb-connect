/**
 * Curated permit entry points, verified against city-published resources in November 2026.
 * This directory does NOT determine jurisdiction or query live permit records.
 * Unknown cities deliberately receive search links, never invented "official" URLs.
 */
export interface PermitPortal {
  city: string;
  state: string;
  name: string;
  applyUrl: string;
  statusUrl: string;
  sourceUrl: string;
  guidance: string;
}

export const VERIFIED_PERMIT_PORTALS: readonly PermitPortal[] = [
  {
    city: 'Carrollton',
    state: 'TX',
    name: 'Carrollton CityServe',
    applyUrl: 'https://cityserve.cityofcarrollton.com/cityviewportal',
    statusUrl: 'https://cityserve.cityofcarrollton.com/cityviewportal',
    sourceUrl: 'https://www.cityofcarrollton.com/about-us/stay-connected/cityserve-permits-inspections',
    guidance: 'Use Building Department > Apply for a Building Permit or Application Search. Confirm whether a separate right-of-way approval is needed.',
  },
  {
    city: 'Dallas',
    state: 'TX',
    name: 'DallasNow (Accela)',
    applyUrl: 'https://aca-prod.accela.com/dallastx/default.aspx',
    statusUrl: 'https://aca-prod.accela.com/dallastx/default.aspx',
    sourceUrl: 'https://aca-prod.accela.com/dallastx/default.aspx',
    guidance: 'Choose Building or Public Works as appropriate. Use Search Records/Applications to check submitted records.',
  },
  {
    city: 'Fort Worth',
    state: 'TX',
    name: 'Fort Worth Development Services',
    applyUrl: 'https://www.fortworthtexas.gov/departments/development-services/permits/streets',
    statusUrl: 'https://www.fortworthtexas.gov/departments/development-services/permits/streets',
    sourceUrl: 'https://www.fortworthtexas.gov/departments/development-services/permits/streets',
    guidance: 'For curb or street work, review Street Use / Parkway requirements and follow the city link to Accela to apply or find a permit.',
  },
  {
    city: 'Austin',
    state: 'TX',
    name: 'Austin Build + Connect',
    applyUrl: 'https://www.austintexas.gov/development-services/austin-build-connect-abc',
    statusUrl: 'https://www.austintexas.gov/development-services/austin-build-connect-abc',
    sourceUrl: 'https://www.austintexas.gov/development-services/austin-build-connect-abc',
    guidance: 'Choose Apply for ROW/Special Events for right-of-way work, or Public Search for permit and case history.',
  },
  {
    city: 'Houston',
    state: 'TX',
    name: 'Houston Permit Portal',
    applyUrl: 'https://permits.houstontx.gov/',
    statusUrl: 'https://permits.houstontx.gov/',
    sourceUrl: 'https://permits.houstontx.gov/',
    guidance: 'The city portal supports applications, permit searches, fee payments and inspection requests.',
  },
  {
    city: 'San Antonio',
    state: 'TX',
    name: 'BuildSA Online Services',
    applyUrl: 'https://www.sa.gov/Directory/Departments/DSD/BuildSA',
    statusUrl: 'https://www.sa.gov/Directory/Departments/DSD/BuildSA',
    sourceUrl: 'https://www.sa.gov/Directory/Departments/DSD/BuildSA',
    guidance: 'Follow Access Online Services for applications and searches. Some right-of-way permits may have a separate process.',
  },
  {
    city: 'Plano',
    state: 'TX',
    name: 'Plano eTRAKiT',
    applyUrl: 'https://trakit.plano.gov/etrakit_prod/default.aspx',
    statusUrl: 'https://trakit.plano.gov/etrakit_prod/default.aspx',
    sourceUrl: 'https://www.plano.gov/city-services',
    guidance: 'Select Apply / New Permit or Search Permit. Confirm separate public right-of-way requirements with the city.',
  },
  {
    city: 'Arlington',
    state: 'TX',
    name: 'Arlington Permits',
    applyUrl: 'https://ap.arlingtontx.gov/',
    statusUrl: 'https://ap.arlingtontx.gov/',
    sourceUrl: 'https://www.arlingtontx.gov/City-Services/Permits',
    guidance: 'Use Arlington Permits to apply or check status; confirm the appropriate permit type before curb work.',
  },
  {
    city: 'Frisco',
    state: 'TX',
    name: 'Frisco Plans & Permits',
    applyUrl: 'https://friscoplansandpermits.avolvecloud.com/Portal/Login/Index/FRISCO',
    statusUrl: 'https://etrakit.friscotexas.gov/etrakit/',
    sourceUrl: 'https://www.friscotexas.gov/395/Building-Inspections',
    guidance: 'Submit plans with Plans & Permits; use eTRAKiT for permit status and inspections. Public Works ROW projects may require a different application.',
  },
  {
    city: 'Irving',
    state: 'TX',
    name: 'Irving My Government Online',
    applyUrl: 'https://www.irvingtx.gov/index.php?section=Online-Permit-Instructions',
    statusUrl: 'https://www.irvingtx.gov/index.php?section=Online-Permit-Instructions',
    sourceUrl: 'https://www.irvingtx.gov/index.php?section=Online-Permit-Instructions',
    guidance: 'Follow the official city instructions to MGO Connect for applications, status and inspections.',
  },
  {
    city: 'McKinney',
    state: 'TX',
    name: 'McKinney ROWAY (right of way)',
    applyUrl: 'https://mckinney.tx.roway.net/',
    statusUrl: 'https://mckinney.tx.roway.net/',
    sourceUrl: 'https://www.mckinneytexas.org/165/Permits',
    guidance: 'ROWAY covers right-of-way work. Building permits use a different city portal; confirm the correct department.',
  },
];

export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
] as const;

export function normalizedCity(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized === 'ft worth' ? 'fort worth' : normalized;
}

export interface PermitLinks {
  city: string;
  state: string;
  verified: boolean;
  name: string;
  applyUrl: string;
  statusUrl: string;
  sourceUrl: string | null;
  guidance: string;
}

function searchUrl(query: string): string {
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', query);
  return url.toString();
}

/** No claim of an official link or live status for locations outside the curated directory. */
export function permitLinksFor(cityInput: string, stateInput: string, countyInput = ''): PermitLinks | null {
  const city = cityInput.trim().replace(/\s+/g, ' ');
  const state = stateInput.trim().toUpperCase();
  if (!city || !US_STATES.some(([code]) => code === state)) return null;
  const known = VERIFIED_PERMIT_PORTALS.find(
    (p) => p.state === state && normalizedCity(p.city) === normalizedCity(city),
  );
  if (known) return { ...known, verified: true };
  const county = countyInput.trim().replace(/\s+/g, ' ');
  const location = [city, county, state].filter(Boolean).join(', ');
  return {
    city,
    state,
    verified: false,
    name: 'Find the official municipal permit office',
    applyUrl: searchUrl(location + ' official city government right of way curb cut permit application'),
    statusUrl: searchUrl(location + ' official city government permit status lookup'),
    sourceUrl: null,
    guidance: 'Search results are not verified municipal portals. Confirm the address and permitting jurisdiction on the city or county government website before applying or paying.',
  };
}
