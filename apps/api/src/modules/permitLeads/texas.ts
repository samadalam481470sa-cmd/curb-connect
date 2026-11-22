// Texas geography used by the permit job search. Every Texas city can be searched: cities listed
// here carry their county and metro so leads can be ranked by distance from the contractor's base.
// Cities not listed are still accepted by name; they rank as "elsewhere in Texas".

export type Metro =
  | 'DFW'
  | 'Houston'
  | 'Austin'
  | 'San Antonio'
  | 'El Paso'
  | 'Rio Grande Valley'
  | 'Corpus Christi'
  | 'Lubbock'
  | 'Amarillo'
  | 'Midland-Odessa'
  | 'Waco'
  | 'Bryan-College Station'
  | 'Killeen-Temple'
  | 'Tyler-Longview'
  | 'Beaumont'
  | 'Laredo'
  | 'Abilene'
  | 'Wichita Falls'
  | 'San Angelo'
  | 'Sherman-Denison'
  | 'Victoria'
  | 'Other Texas';

export interface TexasCity {
  name: string;
  county: string;
  metro: Metro;
}

const c = (name: string, county: string, metro: Metro): TexasCity => ({ name, county, metro });

/** Texas cities with county and metro. Names are matched case-insensitively. */
export const TEXAS_CITIES: readonly TexasCity[] = [
  // Dallas-Fort Worth
  c('Dallas', 'Dallas', 'DFW'),
  c('Fort Worth', 'Tarrant', 'DFW'),
  c('Arlington', 'Tarrant', 'DFW'),
  c('Plano', 'Collin', 'DFW'),
  c('Irving', 'Dallas', 'DFW'),
  c('Garland', 'Dallas', 'DFW'),
  c('Frisco', 'Collin', 'DFW'),
  c('McKinney', 'Collin', 'DFW'),
  c('Grand Prairie', 'Dallas', 'DFW'),
  c('Denton', 'Denton', 'DFW'),
  c('Mesquite', 'Dallas', 'DFW'),
  c('Carrollton', 'Dallas', 'DFW'),
  c('Richardson', 'Dallas', 'DFW'),
  c('Lewisville', 'Denton', 'DFW'),
  c('Allen', 'Collin', 'DFW'),
  c('Flower Mound', 'Denton', 'DFW'),
  c('North Richland Hills', 'Tarrant', 'DFW'),
  c('Mansfield', 'Tarrant', 'DFW'),
  c('Rowlett', 'Dallas', 'DFW'),
  c('Euless', 'Tarrant', 'DFW'),
  c('DeSoto', 'Dallas', 'DFW'),
  c('Grapevine', 'Tarrant', 'DFW'),
  c('Bedford', 'Tarrant', 'DFW'),
  c('Cedar Hill', 'Dallas', 'DFW'),
  c('Haltom City', 'Tarrant', 'DFW'),
  c('Wylie', 'Collin', 'DFW'),
  c('Keller', 'Tarrant', 'DFW'),
  c('Coppell', 'Dallas', 'DFW'),
  c('Rockwall', 'Rockwall', 'DFW'),
  c('Burleson', 'Johnson', 'DFW'),
  c('Hurst', 'Tarrant', 'DFW'),
  c('Duncanville', 'Dallas', 'DFW'),
  c('The Colony', 'Denton', 'DFW'),
  c('Little Elm', 'Denton', 'DFW'),
  c('Lancaster', 'Dallas', 'DFW'),
  c('Prosper', 'Collin', 'DFW'),
  c('Celina', 'Collin', 'DFW'),
  c('Princeton', 'Collin', 'DFW'),
  c('Anna', 'Collin', 'DFW'),
  c('Forney', 'Kaufman', 'DFW'),
  c('Waxahachie', 'Ellis', 'DFW'),
  c('Midlothian', 'Ellis', 'DFW'),
  c('Cleburne', 'Johnson', 'DFW'),
  c('Weatherford', 'Parker', 'DFW'),
  c('Southlake', 'Tarrant', 'DFW'),
  c('Colleyville', 'Tarrant', 'DFW'),
  c('Farmers Branch', 'Dallas', 'DFW'),
  c('Addison', 'Dallas', 'DFW'),
  c('Sachse', 'Dallas', 'DFW'),
  c('Murphy', 'Collin', 'DFW'),
  c('Saginaw', 'Tarrant', 'DFW'),
  c('Benbrook', 'Tarrant', 'DFW'),
  c('Watauga', 'Tarrant', 'DFW'),
  c('Corinth', 'Denton', 'DFW'),
  c('Highland Village', 'Denton', 'DFW'),
  c('Royse City', 'Rockwall', 'DFW'),
  c('Terrell', 'Kaufman', 'DFW'),
  c('Crowley', 'Tarrant', 'DFW'),
  c('Fate', 'Rockwall', 'DFW'),
  c('Aubrey', 'Denton', 'DFW'),
  c('Melissa', 'Collin', 'DFW'),
  c('Fairview', 'Collin', 'DFW'),
  c('University Park', 'Dallas', 'DFW'),
  c('Highland Park', 'Dallas', 'DFW'),
  c('Balch Springs', 'Dallas', 'DFW'),
  c('Seagoville', 'Dallas', 'DFW'),
  c('Glenn Heights', 'Dallas', 'DFW'),
  c('Red Oak', 'Ellis', 'DFW'),
  c('Ennis', 'Ellis', 'DFW'),
  c('Granbury', 'Hood', 'DFW'),
  c('Azle', 'Tarrant', 'DFW'),
  c('Northlake', 'Denton', 'DFW'),
  c('Argyle', 'Denton', 'DFW'),
  c('Trophy Club', 'Denton', 'DFW'),
  c('Roanoke', 'Denton', 'DFW'),
  c('Haslet', 'Tarrant', 'DFW'),
  c('Heath', 'Rockwall', 'DFW'),
  // Houston
  c('Houston', 'Harris', 'Houston'),
  c('Pasadena', 'Harris', 'Houston'),
  c('Pearland', 'Brazoria', 'Houston'),
  c('League City', 'Galveston', 'Houston'),
  c('Sugar Land', 'Fort Bend', 'Houston'),
  c('Baytown', 'Harris', 'Houston'),
  c('Conroe', 'Montgomery', 'Houston'),
  c('Missouri City', 'Fort Bend', 'Houston'),
  c('Katy', 'Harris', 'Houston'),
  c('The Woodlands', 'Montgomery', 'Houston'),
  c('Spring', 'Harris', 'Houston'),
  c('Cypress', 'Harris', 'Houston'),
  c('Humble', 'Harris', 'Houston'),
  c('Friendswood', 'Galveston', 'Houston'),
  c('Galveston', 'Galveston', 'Houston'),
  c('Texas City', 'Galveston', 'Houston'),
  c('Rosenberg', 'Fort Bend', 'Houston'),
  c('Richmond', 'Fort Bend', 'Houston'),
  c('Tomball', 'Harris', 'Houston'),
  c('La Porte', 'Harris', 'Houston'),
  c('Deer Park', 'Harris', 'Houston'),
  c('Bellaire', 'Harris', 'Houston'),
  c('Webster', 'Harris', 'Houston'),
  c('Fulshear', 'Fort Bend', 'Houston'),
  c('Magnolia', 'Montgomery', 'Houston'),
  c('Lake Jackson', 'Brazoria', 'Houston'),
  c('Alvin', 'Brazoria', 'Houston'),
  c('Dickinson', 'Galveston', 'Houston'),
  c('Stafford', 'Fort Bend', 'Houston'),
  c('Kingwood', 'Harris', 'Houston'),
  c('Atascocita', 'Harris', 'Houston'),
  c('Waller', 'Waller', 'Houston'),
  // Austin
  c('Austin', 'Travis', 'Austin'),
  c('Round Rock', 'Williamson', 'Austin'),
  c('Georgetown', 'Williamson', 'Austin'),
  c('Cedar Park', 'Williamson', 'Austin'),
  c('Pflugerville', 'Travis', 'Austin'),
  c('Leander', 'Williamson', 'Austin'),
  c('San Marcos', 'Hays', 'Austin'),
  c('Kyle', 'Hays', 'Austin'),
  c('Buda', 'Hays', 'Austin'),
  c('Hutto', 'Williamson', 'Austin'),
  c('Lakeway', 'Travis', 'Austin'),
  c('Bastrop', 'Bastrop', 'Austin'),
  c('Manor', 'Travis', 'Austin'),
  c('Dripping Springs', 'Hays', 'Austin'),
  c('Taylor', 'Williamson', 'Austin'),
  c('Liberty Hill', 'Williamson', 'Austin'),
  c('Lockhart', 'Caldwell', 'Austin'),
  c('Elgin', 'Bastrop', 'Austin'),
  // San Antonio
  c('San Antonio', 'Bexar', 'San Antonio'),
  c('New Braunfels', 'Comal', 'San Antonio'),
  c('Schertz', 'Guadalupe', 'San Antonio'),
  c('Seguin', 'Guadalupe', 'San Antonio'),
  c('Cibolo', 'Guadalupe', 'San Antonio'),
  c('Converse', 'Bexar', 'San Antonio'),
  c('Boerne', 'Kendall', 'San Antonio'),
  c('Universal City', 'Bexar', 'San Antonio'),
  c('Live Oak', 'Bexar', 'San Antonio'),
  c('Helotes', 'Bexar', 'San Antonio'),
  c('Leon Valley', 'Bexar', 'San Antonio'),
  // Other metros
  c('El Paso', 'El Paso', 'El Paso'),
  c('Socorro', 'El Paso', 'El Paso'),
  c('Horizon City', 'El Paso', 'El Paso'),
  c('McAllen', 'Hidalgo', 'Rio Grande Valley'),
  c('Edinburg', 'Hidalgo', 'Rio Grande Valley'),
  c('Mission', 'Hidalgo', 'Rio Grande Valley'),
  c('Pharr', 'Hidalgo', 'Rio Grande Valley'),
  c('Brownsville', 'Cameron', 'Rio Grande Valley'),
  c('Harlingen', 'Cameron', 'Rio Grande Valley'),
  c('Weslaco', 'Hidalgo', 'Rio Grande Valley'),
  c('San Benito', 'Cameron', 'Rio Grande Valley'),
  c('Corpus Christi', 'Nueces', 'Corpus Christi'),
  c('Portland', 'San Patricio', 'Corpus Christi'),
  c('Lubbock', 'Lubbock', 'Lubbock'),
  c('Amarillo', 'Potter', 'Amarillo'),
  c('Canyon', 'Randall', 'Amarillo'),
  c('Midland', 'Midland', 'Midland-Odessa'),
  c('Odessa', 'Ector', 'Midland-Odessa'),
  c('Waco', 'McLennan', 'Waco'),
  c('Hewitt', 'McLennan', 'Waco'),
  c('College Station', 'Brazos', 'Bryan-College Station'),
  c('Bryan', 'Brazos', 'Bryan-College Station'),
  c('Killeen', 'Bell', 'Killeen-Temple'),
  c('Temple', 'Bell', 'Killeen-Temple'),
  c('Harker Heights', 'Bell', 'Killeen-Temple'),
  c('Belton', 'Bell', 'Killeen-Temple'),
  c('Copperas Cove', 'Coryell', 'Killeen-Temple'),
  c('Tyler', 'Smith', 'Tyler-Longview'),
  c('Longview', 'Gregg', 'Tyler-Longview'),
  c('Beaumont', 'Jefferson', 'Beaumont'),
  c('Port Arthur', 'Jefferson', 'Beaumont'),
  c('Laredo', 'Webb', 'Laredo'),
  c('Abilene', 'Taylor', 'Abilene'),
  c('Wichita Falls', 'Wichita', 'Wichita Falls'),
  c('San Angelo', 'Tom Green', 'San Angelo'),
  c('Sherman', 'Grayson', 'Sherman-Denison'),
  c('Denison', 'Grayson', 'Sherman-Denison'),
  c('Victoria', 'Victoria', 'Victoria'),
  c('Texarkana', 'Bowie', 'Other Texas'),
  c('Nacogdoches', 'Nacogdoches', 'Other Texas'),
  c('Lufkin', 'Angelina', 'Other Texas'),
  c('Huntsville', 'Walker', 'Other Texas'),
  c('Del Rio', 'Val Verde', 'Other Texas'),
  c('Eagle Pass', 'Maverick', 'Other Texas'),
  c('Kerrville', 'Kerr', 'Other Texas'),
  c('Big Spring', 'Howard', 'Other Texas'),
  c('Paris', 'Lamar', 'Other Texas'),
  c('Marshall', 'Harrison', 'Other Texas'),
];

const BY_NAME = new Map(TEXAS_CITIES.map((city) => [city.name.toLowerCase(), city]));

export function cleanCityName(raw: string): string {
  return raw
    .replace(/[^A-Za-z .'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Look up a Texas city. Unknown names still resolve so every Texas city can be searched. */
export function findTexasCity(raw: string): TexasCity {
  const name = cleanCityName(raw);
  return BY_NAME.get(name.toLowerCase()) ?? { name, county: '', metro: 'Other Texas' };
}

/** 0 = same city, 1 = same county, 2 = same metro, 3 = elsewhere in Texas. */
export function distanceTier(home: TexasCity, target: TexasCity): 0 | 1 | 2 | 3 {
  if (home.name.toLowerCase() === target.name.toLowerCase()) return 0;
  if (home.county && home.county === target.county) return 1;
  if (home.metro !== 'Other Texas' && home.metro === target.metro) return 2;
  return 3;
}

export const DISTANCE_LABEL = [
  'Your city',
  'Your county',
  'Your metro',
  'Elsewhere in Texas',
] as const;

/**
 * Official places to look a city up when it has no live open-data feed. Each link is a search on a
 * government site or a web search limited to government domains; nothing here is scraped.
 */
export function officialLookupLinks(city: TexasCity): { label: string; url: string }[] {
  const q = (text: string) => encodeURIComponent(text);
  const county = city.county ? `${city.county} County` : '';
  return [
    {
      label: `${city.name} building permit portal (government sites only)`,
      url: `https://www.google.com/search?q=${q(`"${city.name}" Texas building permits issued`)}+site%3A.gov+OR+site%3Atx.us`,
    },
    ...(county
      ? [
          {
            label: `${county} development and permit records`,
            url: `https://www.google.com/search?q=${q(`"${county}" Texas permits development`)}+site%3A.gov+OR+site%3Atx.us`,
          },
        ]
      : []),
    {
      label: 'Texas Comptroller business entity search (who owns the builder)',
      url: 'https://comptroller.texas.gov/taxes/franchise/account-status/search',
    },
    {
      label: 'Texas Secretary of State business filings (SOSDirect)',
      url: 'https://www.sos.state.tx.us/corp/sosda/index.shtml',
    },
  ];
}
