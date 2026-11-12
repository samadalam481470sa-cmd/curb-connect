import { DETAILED_MATERIALS, type DetailedMaterialId } from './detailedCatalog';

// House Builder reference price book (HB-002).
//
// Every price here is a dated reference taken from a public retailer listing or a published 2026
// price guide, with the source recorded next to it. They are planning numbers, not quotes: the
// workspace always shows the range, names the source and offers a live lookup so the estimator can
// replace any line with a current local price. Items with no published reference stay unpriced
// (null) instead of getting a made-up number.

export type SupplierId = 'home_depot' | 'lowes' | 'menards' | 'walmart' | 'google' | 'local';

export interface Supplier {
  id: SupplierId;
  name: string;
  /** Search page for a free-text query. */
  searchUrl: (query: string) => string;
}

const enc = encodeURIComponent;

export const SUPPLIERS: Record<SupplierId, Supplier> = {
  home_depot: {
    id: 'home_depot',
    name: 'Home Depot',
    searchUrl: (q) => `https://www.homedepot.com/s/${enc(q)}`,
  },
  lowes: {
    id: 'lowes',
    name: "Lowe's",
    searchUrl: (q) => `https://www.lowes.com/search?searchTerm=${enc(q)}`,
  },
  menards: {
    id: 'menards',
    name: 'Menards',
    searchUrl: (q) => `https://www.menards.com/main/search.html?search=${enc(q)}`,
  },
  walmart: {
    id: 'walmart',
    name: 'Walmart',
    searchUrl: (q) => `https://www.walmart.com/search?q=${enc(q)}`,
  },
  google: {
    id: 'google',
    name: 'Google Shopping',
    searchUrl: (q) => `https://www.google.com/search?tbm=shop&q=${enc(q)}`,
  },
  local: {
    id: 'local',
    name: 'Local supplier',
    searchUrl: (q) => `https://www.google.com/maps/search/${enc(q + ' supplier near me')}`,
  },
};

/** Retailers we link for every material, in display order. */
export const LINKED_SUPPLIERS: readonly SupplierId[] = [
  'home_depot',
  'lowes',
  'menards',
  'walmart',
  'google',
];

export interface ObservedOffer {
  supplier: SupplierId;
  /** Seller name when it is not one of the linked retailers. */
  sellerName?: string;
  price: number;
  note: string;
  sourceUrl: string;
}

export interface MaterialPrice {
  id: MaterialId;
  label: string;
  unit: string;
  /** What to type into a retailer search box. */
  searchQuery: string;
  /** Published planning range; null when no reference was found. */
  range: { low: number; typical: number; high: number } | null;
  /** Individual listed prices seen at named sellers. */
  offers: readonly ObservedOffer[];
  source: { title: string; url: string };
  asOf: string;
}

const BASE_MATERIAL_IDS = [
  'concrete_ready_mix',
  'rebar_4_20ft',
  'vapor_barrier',
  'stud_2x4x8',
  'lumber_2x6x8',
  'osb_7_16',
  'subfloor_23_32',
  'roof_truss',
  'shingle_bundle',
  'underlayment_roll',
  'house_wrap',
  'siding_fiber_cement',
  'insulation_r13',
  'insulation_attic',
  'drywall_1_2',
  'joint_compound',
  'window_vinyl',
  'door_exterior',
  'door_interior',
] as const;
export type MaterialId = (typeof BASE_MATERIAL_IDS)[number] | DetailedMaterialId;
export const MATERIAL_IDS: readonly MaterialId[] = [...BASE_MATERIAL_IDS, ...DETAILED_MATERIALS.map((m) => m.id)];

const AS_OF = '2026-11';

const BASE_PRICE_BOOK: Record<(typeof BASE_MATERIAL_IDS)[number], MaterialPrice> = {
  concrete_ready_mix: {
    id: 'concrete_ready_mix',
    label: 'Ready-mix concrete, 3000 PSI',
    unit: 'yd³',
    searchQuery: 'ready mix concrete delivery per yard',
    range: { low: 119, typical: 141, high: 200 },
    offers: [],
    source: {
      title: 'ConstructlyTools, Concrete slab cost Dallas 2026 (DFW ready-mix $119–$141/yd³)',
      url: 'https://constructlytools.com/cost-estimators/location-guides/concrete-slab-cost-dallas/',
    },
    asOf: AS_OF,
  },
  rebar_4_20ft: {
    id: 'rebar_4_20ft',
    label: '#4 rebar, 1/2 in × 20 ft',
    unit: 'stick',
    searchQuery: '#4 rebar 1/2 in x 20 ft',
    range: { low: 6, typical: 11, high: 18 },
    offers: [
      {
        supplier: 'local',
        sellerName: 'Steel Supply LP',
        price: 10.67,
        note: 'Grade 40, 1–49 sticks',
        sourceUrl:
          'https://steelsupplylp.com/structural-steel/steel-supply-store/rebar/rebar-carbon-steel',
      },
    ],
    source: {
      title: 'LatestCost, #4 rebar 20 ft price 2026',
      url: 'https://latestcost.com/4-rebar-20-ft-price-typical-costs-tips/',
    },
    asOf: AS_OF,
  },
  vapor_barrier: {
    id: 'vapor_barrier',
    label: 'Poly vapor barrier, 6 mil, 10 × 100 ft',
    unit: 'roll',
    searchQuery: '6 mil poly vapor barrier 10 ft x 100 ft',
    range: null,
    offers: [],
    source: { title: 'No published reference found: use live lookup', url: '' },
    asOf: AS_OF,
  },
  stud_2x4x8: {
    id: 'stud_2x4x8',
    label: '2×4×8 stud (SPF/SYP)',
    unit: 'pc',
    searchQuery: '2 in x 4 in x 8 ft stud',
    range: { low: 3.5, typical: 4.75, high: 7 },
    offers: [],
    source: {
      title: "LatestCost, Lowe's vs Home Depot lumber prices compared 2026",
      url: 'https://latestcost.com/lowes-home-depot-lumber-prices-compared/',
    },
    asOf: AS_OF,
  },
  lumber_2x6x8: {
    id: 'lumber_2x6x8',
    label: '2×6×8 board (headers, blocking)',
    unit: 'pc',
    searchQuery: '2 in x 6 in x 8 ft lumber',
    range: { low: 6, typical: 8, high: 12 },
    offers: [],
    source: {
      title: "LatestCost, Lowe's vs Home Depot lumber prices compared 2026",
      url: 'https://latestcost.com/lowes-home-depot-lumber-prices-compared/',
    },
    asOf: AS_OF,
  },
  osb_7_16: {
    id: 'osb_7_16',
    label: 'OSB sheathing 7/16 in, 4 × 8',
    unit: 'sheet',
    searchQuery: '7/16 in x 4 ft x 8 ft OSB sheathing',
    range: { low: 12, typical: 16.5, high: 25 },
    offers: [
      {
        supplier: 'local',
        sellerName: 'Foundation Building Materials',
        price: 14.24,
        note: '$445/MSF',
        sourceUrl:
          'https://myfbm.com/all-products/lumber-%26-plywoods/plywood/7-16-in-x-4-ft-x-8-ft-osb-sheathing-plywood/p/osb716-msf',
      },
    ],
    source: {
      title: 'BuilderMuse, OSB vs plywood prices 2026 (national average $16.50)',
      url: 'https://buildermuse.com/economy/osb-vs-plywood-prices-2026/',
    },
    asOf: AS_OF,
  },
  subfloor_23_32: {
    id: 'subfloor_23_32',
    label: 'Subfloor OSB 23/32 in T&G, 4 × 8',
    unit: 'sheet',
    searchQuery: '23/32 in x 4 ft x 8 ft OSB tongue and groove subfloor',
    range: { low: 20, typical: 29, high: 40 },
    offers: [],
    source: {
      title: 'LatestCost, How much does OSB board cost 2026',
      url: 'https://latestcost.com/how-much-does-osb-board-cost/',
    },
    asOf: AS_OF,
  },
  roof_truss: {
    id: 'roof_truss',
    label: 'Roof truss, common (fink)',
    unit: 'truss',
    searchQuery: 'roof truss common fink',
    range: { low: 100, typical: 180, high: 350 },
    offers: [],
    source: {
      title: 'Shingles Calculator, Roof truss calculator 2026 ($100–$250 for 24–30 ft spans)',
      url: 'https://shinglescalculator.pages.dev/calculators/roof-truss-calculator/',
    },
    asOf: AS_OF,
  },
  shingle_bundle: {
    id: 'shingle_bundle',
    label: 'Architectural shingles (33.3 sq ft bundle)',
    unit: 'bundle',
    searchQuery: 'architectural shingles bundle 33.3 sq ft',
    range: { low: 34, typical: 40, high: 60 },
    offers: [
      {
        supplier: 'home_depot',
        price: 37.97,
        note: 'GAF Timberline Natural Shadow; $34.17 each at 36+',
        sourceUrl:
          'https://homedepot.com/b/Building-Materials-Roofing-Gutters-Roofing-Roof-Shingles/Asphalt/N-5yc1vZc5rbZ1z0uet9',
      },
    ],
    source: {
      title: 'Home Depot asphalt shingle listings',
      url: 'https://homedepot.com/b/Building-Materials-Roofing-Gutters-Roofing-Roof-Shingles/Asphalt/N-5yc1vZc5rbZ1z0uet9',
    },
    asOf: AS_OF,
  },
  underlayment_roll: {
    id: 'underlayment_roll',
    label: 'Synthetic roof underlayment, 10 squares',
    unit: 'roll',
    searchQuery: 'synthetic roof underlayment 10 square roll',
    range: { low: 128.5, typical: 180, high: 247 },
    offers: [
      {
        supplier: 'walmart',
        price: 179.95,
        note: 'Protectite Ultra 4 × 250 ft',
        sourceUrl: 'https://www.walmart.com/ip/141005299',
      },
      {
        supplier: 'local',
        sellerName: 'SuperArbor',
        price: 128.5,
        note: 'CertainTeed RoofRunner, $399 order minimum',
        sourceUrl:
          'https://superarbor.io/products/certainteed-roofrunner-synthetic-roofing-underlayment-10-square-roll-gray',
      },
    ],
    source: {
      title: 'Retailer listings (Walmart, SuperArbor)',
      url: 'https://www.walmart.com/ip/141005299',
    },
    asOf: AS_OF,
  },
  house_wrap: {
    id: 'house_wrap',
    label: 'House wrap, 9 × 150 ft',
    unit: 'roll',
    searchQuery: 'house wrap 9 ft x 150 ft',
    range: null,
    offers: [],
    source: { title: 'No published reference found: use live lookup', url: '' },
    asOf: AS_OF,
  },
  siding_fiber_cement: {
    id: 'siding_fiber_cement',
    label: 'Fiber cement lap siding (material)',
    unit: 'sq ft',
    searchQuery: 'fiber cement lap siding plank',
    range: { low: 0.7, typical: 2.5, high: 4 },
    offers: [],
    source: {
      title: 'HomeServe, Hardie board siding cost guide (lap $0.70–$4/sq ft material)',
      url: 'https://www.homeserve.com/blog/cost-guide/hardie-board-siding/',
    },
    asOf: AS_OF,
  },
  insulation_r13: {
    id: 'insulation_r13',
    label: 'R-13 fiberglass batt (walls)',
    unit: 'sq ft',
    searchQuery: 'R-13 faced fiberglass insulation',
    range: { low: 0.4, typical: 0.65, high: 1.2 },
    offers: [
      {
        supplier: 'home_depot',
        price: 0.62,
        note: 'Owens Corning R-13 faced roll, $24.97 / 40 sq ft',
        sourceUrl:
          'https://www.homedepot.com/p/Owens-Corning-R-13-Faced-Fiberglass-Insulation-Roll-15-in-x-32-ft-1-Roll-RF10/202585857',
      },
    ],
    source: {
      title: 'LatestCost, R-13 insulation cost per square foot 2026',
      url: 'https://latestcost.com/r-13-insulation-cost-per-square-foot/',
    },
    asOf: AS_OF,
  },
  insulation_attic: {
    id: 'insulation_attic',
    label: 'Attic insulation, R-30/R-38 batt or blown',
    unit: 'sq ft',
    searchQuery: 'R-38 attic insulation',
    range: { low: 0.3, typical: 1, high: 1.5 },
    offers: [],
    source: {
      title: 'DG Floors, How much is a roll of insulation (fiberglass $0.30–$1.50/sq ft)',
      url: 'https://dgfloors.com/how-much-is-a-roll-of-insulation/',
    },
    asOf: AS_OF,
  },
  drywall_1_2: {
    id: 'drywall_1_2',
    label: 'Drywall 1/2 in, 4 × 8',
    unit: 'sheet',
    searchQuery: '1/2 in x 4 ft x 8 ft drywall',
    range: { low: 12, typical: 15, high: 18 },
    offers: [
      {
        supplier: 'home_depot',
        price: 15.58,
        note: 'USG Sheetrock UltraLight; $13.24 each at 34+',
        sourceUrl:
          'https://Homedepot.com/b/Building-Materials-Drywall-Drywall-Sheets/4x8/N-5yc1vZbb52Z1z18jbl',
      },
    ],
    source: {
      title: 'Drywall Installation Cost, 1/2 inch drywall cost 2026',
      url: 'https://drywallinstallationcost-dfp.pages.dev/half-inch-drywall-cost/',
    },
    asOf: AS_OF,
  },
  joint_compound: {
    id: 'joint_compound',
    label: 'Joint compound, 5 gal',
    unit: 'bucket',
    searchQuery: 'all purpose joint compound 5 gallon',
    range: { low: 15, typical: 20, high: 25 },
    offers: [],
    source: {
      title: 'Drywall Installation Cost, Drywall materials cost 2026',
      url: 'https://drywallinstallationcost-dfp.pages.dev/drywall-materials-cost',
    },
    asOf: AS_OF,
  },
  window_vinyl: {
    id: 'window_vinyl',
    label: 'Vinyl double-hung window, ~30 × 54 in',
    unit: 'ea',
    searchQuery: 'vinyl double hung window new construction 30 x 54',
    range: { low: 175, typical: 330, high: 600 },
    offers: [
      {
        supplier: 'home_depot',
        price: 329.77,
        note: 'JELD-WEN V-2500 29.5 × 54 in nail fin',
        sourceUrl: 'https://www.homedepot.com/p/p/332713282',
      },
    ],
    source: {
      title: 'Home Depot window listing; HomeGrail window price ranges',
      url: 'https://homegrail.com/how-much-does-home-depot-charge-to-install-a-window/',
    },
    asOf: AS_OF,
  },
  door_exterior: {
    id: 'door_exterior',
    label: 'Exterior prehung steel door, 36 × 80',
    unit: 'ea',
    searchQuery: 'prehung steel exterior door 36 x 80',
    range: { low: 264, typical: 340, high: 558 },
    offers: [
      {
        supplier: 'home_depot',
        price: 264,
        note: 'Masonite Premium 6-panel primed steel',
        sourceUrl:
          'https://homedepot.com/b/Doors-Windows/EZ/ISLIFE/Masonite/VELUX/N-5yc1vZaqihZyqZ1kaZ7fmZvf8Zbwo5lZ1z1wgir',
      },
    ],
    source: {
      title: 'Home Depot exterior door listings',
      url: 'https://homedepot.com/b/JELD-WEN/Karran/N-5yc1vZ2heZcb0Z12l4Z12l5Z12l6Z12l8',
    },
    asOf: AS_OF,
  },
  door_interior: {
    id: 'door_interior',
    label: 'Interior prehung door, hollow core',
    unit: 'ea',
    searchQuery: 'prehung interior door hollow core 30 x 80',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 196.35,
        note: 'JELD-WEN 3-panel Birkdale hollow core, from',
        sourceUrl:
          'https://www.homedepot.com/b/Contour/Delphi/ECOSOLUTION/Edie@Home/N-5yc1vZ2heZddrZhppZnw8ZoleZul2Zv5rZvbaZzijZ12l6',
      },
    ],
    source: { title: 'Home Depot interior door listing', url: '' },
    asOf: AS_OF,
  },
};

/** Expanded catalog: no synthetic supplier numbers. Listings are obtained by live lookups
 * or manually entered per-item quotes, and unpriced rows do not enter estimate totals. */
export const PRICE_BOOK: Record<MaterialId, MaterialPrice> = {
  ...BASE_PRICE_BOOK,
  ...(Object.fromEntries(DETAILED_MATERIALS.map((item) => [
    item.id,
    {
      id: item.id,
      label: item.label + ' · allowance',
      unit: item.unit,
      searchQuery: item.searchQuery,
      range: null,
      offers: [],
      source: {
        title: 'Provisional quantity only — requires a matching unit supplier quote',
        url: '',
      },
      asOf: 'unpriced',
    } satisfies MaterialPrice,
  ])) as unknown as Record<DetailedMaterialId, MaterialPrice>),
};

/** Cheapest known reference for a material: lowest observed listing, else the typical range value. */
export function referenceUnitPrice(
  material: MaterialPrice,
): { price: number; seller: string; basis: 'listing' | 'typical' } | null {
  const best = [...material.offers].sort((a, b) => a.price - b.price)[0];
  if (best) {
    return {
      price: best.price,
      seller: best.sellerName ?? SUPPLIERS[best.supplier].name,
      basis: 'listing',
    };
  }
  if (material.range)
    return { price: material.range.typical, seller: 'Typical retail', basis: 'typical' };
  return null;
}

export interface LiveOffer {
  title: string;
  seller: string;
  price: number;
  link: string | null;
}

export interface LivePriceResponse {
  live: boolean;
  query: string;
  offers: LiveOffer[];
  message?: string;
}
