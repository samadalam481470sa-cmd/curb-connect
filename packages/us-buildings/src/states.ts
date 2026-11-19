// The 50 United States. Scope is deliberately US-only. FIPS codes are the standard two-digit state
// codes used by Census and most public building and parcel datasets.
export interface UsState {
  abbr: string;
  fips: string;
  name: string;
}

export const US_STATES: readonly UsState[] = [
  { abbr: 'AL', fips: '01', name: 'Alabama' },
  { abbr: 'AK', fips: '02', name: 'Alaska' },
  { abbr: 'AZ', fips: '04', name: 'Arizona' },
  { abbr: 'AR', fips: '05', name: 'Arkansas' },
  { abbr: 'CA', fips: '06', name: 'California' },
  { abbr: 'CO', fips: '08', name: 'Colorado' },
  { abbr: 'CT', fips: '09', name: 'Connecticut' },
  { abbr: 'DE', fips: '10', name: 'Delaware' },
  { abbr: 'FL', fips: '12', name: 'Florida' },
  { abbr: 'GA', fips: '13', name: 'Georgia' },
  { abbr: 'HI', fips: '15', name: 'Hawaii' },
  { abbr: 'ID', fips: '16', name: 'Idaho' },
  { abbr: 'IL', fips: '17', name: 'Illinois' },
  { abbr: 'IN', fips: '18', name: 'Indiana' },
  { abbr: 'IA', fips: '19', name: 'Iowa' },
  { abbr: 'KS', fips: '20', name: 'Kansas' },
  { abbr: 'KY', fips: '21', name: 'Kentucky' },
  { abbr: 'LA', fips: '22', name: 'Louisiana' },
  { abbr: 'ME', fips: '23', name: 'Maine' },
  { abbr: 'MD', fips: '24', name: 'Maryland' },
  { abbr: 'MA', fips: '25', name: 'Massachusetts' },
  { abbr: 'MI', fips: '26', name: 'Michigan' },
  { abbr: 'MN', fips: '27', name: 'Minnesota' },
  { abbr: 'MS', fips: '28', name: 'Mississippi' },
  { abbr: 'MO', fips: '29', name: 'Missouri' },
  { abbr: 'MT', fips: '30', name: 'Montana' },
  { abbr: 'NE', fips: '31', name: 'Nebraska' },
  { abbr: 'NV', fips: '32', name: 'Nevada' },
  { abbr: 'NH', fips: '33', name: 'New Hampshire' },
  { abbr: 'NJ', fips: '34', name: 'New Jersey' },
  { abbr: 'NM', fips: '35', name: 'New Mexico' },
  { abbr: 'NY', fips: '36', name: 'New York' },
  { abbr: 'NC', fips: '37', name: 'North Carolina' },
  { abbr: 'ND', fips: '38', name: 'North Dakota' },
  { abbr: 'OH', fips: '39', name: 'Ohio' },
  { abbr: 'OK', fips: '40', name: 'Oklahoma' },
  { abbr: 'OR', fips: '41', name: 'Oregon' },
  { abbr: 'PA', fips: '42', name: 'Pennsylvania' },
  { abbr: 'RI', fips: '44', name: 'Rhode Island' },
  { abbr: 'SC', fips: '45', name: 'South Carolina' },
  { abbr: 'SD', fips: '46', name: 'South Dakota' },
  { abbr: 'TN', fips: '47', name: 'Tennessee' },
  { abbr: 'TX', fips: '48', name: 'Texas' },
  { abbr: 'UT', fips: '49', name: 'Utah' },
  { abbr: 'VT', fips: '50', name: 'Vermont' },
  { abbr: 'VA', fips: '51', name: 'Virginia' },
  { abbr: 'WA', fips: '53', name: 'Washington' },
  { abbr: 'WV', fips: '54', name: 'West Virginia' },
  { abbr: 'WI', fips: '55', name: 'Wisconsin' },
  { abbr: 'WY', fips: '56', name: 'Wyoming' },
];

const BY_ABBR = new Map(US_STATES.map((s) => [s.abbr, s]));

/** Look up a state by USPS abbreviation (case-insensitive). Returns null for anything else. */
export function findUsState(input: string): UsState | null {
  return BY_ABBR.get(input.trim().toUpperCase()) ?? null;
}

/** Throws unless the value is one of the 50 states. The product scope is the United States only. */
export function requireUsState(input: string): UsState {
  const state = findUsState(input);
  if (!state) throw new RangeError(`"${input}" is not one of the 50 US states.`);
  return state;
}
