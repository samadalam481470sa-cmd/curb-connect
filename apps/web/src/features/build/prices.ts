import { DETAILED_MATERIALS, type DetailedMaterialId } from './detailedCatalog';

// House Builder reference price book (HB-002).
//
// Base material prices are Home Depot listings with the exact product pack and takeoff unit
// recorded beside each price. Published Home Depot bulk tiers apply only when the takeoff quantity
// reaches the listed threshold. Store/ZIP prices and inventory vary. If no comparable Home Depot
// SKU or unit price is verified, the line stays unpriced instead of borrowing another retailer's
// number or a generic retail range.

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
  /** Home Depot quantity-break price, normalized to the same takeoff unit. */
  bulkPrice?: number;
  /** Minimum takeoff units required for bulkPrice (e.g. sheets, rolls, or sq ft). */
  bulkMinQty?: number;
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

const AS_OF = '2026-11-24';

const BASE_PRICE_BOOK: Record<(typeof BASE_MATERIAL_IDS)[number], MaterialPrice> = {
  concrete_ready_mix: {
    id: 'concrete_ready_mix',
    label: 'Ready-mix concrete, 3000 PSI',
    unit: 'yd³',
    searchQuery: 'ready mix concrete delivery 3000 PSI per cubic yard',
    range: null,
    offers: [],
    source: {
      title: 'No comparable Home Depot delivered-yard price; bagged concrete is not substituted for ready-mix delivery.',
      url: 'https://www.homedepot.com/s/3000%20psi%20ready%20mix%20concrete',
    },
    asOf: 'unpriced',
  },
  rebar_4_20ft: {
    id: 'rebar_4_20ft',
    label: '#4 rebar, 1/2 in × 20 ft',
    unit: 'stick',
    searchQuery: '#4 rebar 1/2 in x 20 ft',
    range: null,
    offers: [],
    source: {
      title: 'Home Depot SKU 202532809; online price is not shown until a store is selected.',
      url: 'https://www.homedepot.com/p/1-2-in-x-20-ft-4-Rebar-REB-4-615G4-20/202532809',
    },
    asOf: 'unpriced',
  },
  vapor_barrier: {
    id: 'vapor_barrier',
    label: 'Poly vapor barrier, 6 mil, 10 × 100 ft',
    unit: 'roll',
    searchQuery: 'HDX 6 mil plastic sheeting 10 ft x 100 ft',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 79.48,
        bulkPrice: 67.56,
        bulkMinQty: 6,
        note: 'HDX model CFHD0610C; 1,000 sq ft roll; 6+ rolls listed at $67.56 each.',
        sourceUrl: 'https://www.homedepot.com/p/319004352',
      },
    ],
    source: {
      title: 'Home Depot · HDX 10 ft × 100 ft, 6 mil plastic sheeting',
      url: 'https://www.homedepot.com/p/319004352',
    },
    asOf: '2026-11-17',
  },
  stud_2x4x8: {
    id: 'stud_2x4x8',
    label: '2×4×8 stud (SPF/SYP)',
    unit: 'pc',
    searchQuery: '2 in x 4 in x 96 in #2 premium grade KD-HT stud',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 3.98,
        bulkPrice: 3.58,
        bulkMinQty: 50,
        note: 'Model 058449; 2 × 4 × 96 in #2 Premium Grade KD-HT; 50+ listed at $3.58 each.',
        sourceUrl: 'https://www.homedepot.com/p/2-in-x-4-in-x-96-in-2-Premium-Grade-KD-HT-Stud-058449/312528776',
      },
    ],
    source: {
      title: 'Home Depot · 2 × 4 × 96 in #2 Premium Grade KD-HT Stud',
      url: 'https://www.homedepot.com/p/2-in-x-4-in-x-96-in-2-Premium-Grade-KD-HT-Stud-058449/312528776',
    },
    asOf: '2026-11-24',
  },
  lumber_2x6x8: {
    id: 'lumber_2x6x8',
    label: '2×6×8 board (headers, blocking)',
    unit: 'pc',
    searchQuery: '2 in x 6 in x 8 ft #2 standard grade SPF dimensional lumber',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 6.72,
        note: 'Model 232419; #2 Standard Grade SPF, nominal 2 × 6 × 8 ft. Verify species/grade for structural use.',
        sourceUrl: 'https://www.homedepot.com/b/Lumber-Composites-Dimensional-Lumber-Framing-Lumber/8-ft/2/6-in/N-5yc1vZc55wZ1z0mcqtZ1z1rkokZ1z1rkql',
      },
    ],
    source: {
      title: 'Home Depot · 2 × 6 × 8 ft #2 Standard Grade SPF lumber',
      url: 'https://www.homedepot.com/b/Lumber-Composites-Dimensional-Lumber-Framing-Lumber/8-ft/2/6-in/N-5yc1vZc55wZ1z0mcqtZ1z1rkokZ1z1rkql',
    },
    asOf: '2026-11-10',
  },
  osb_7_16: {
    id: 'osb_7_16',
    label: 'OSB sheathing 7/16 in, 4 × 8',
    unit: 'sheet',
    searchQuery: 'OSB 7/16 application as 4 ft x 8 ft sheathing panel model 386081',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 13.63,
        bulkPrice: 12.95,
        bulkMinQty: 68,
        note: 'Model 386081; 4 × 8 ft rated sheathing; 68+ listed at $12.95 per sheet.',
        sourceUrl: 'https://www.homedepot.com/b/Lumber-Composites-Plywood-Oriented-Strand-Board-OSB/7-16/4-ft-x-8-ft/Rated-Sheathing/N-5yc1vZbqpqZ1z0mcpwZ1z1a6x9Z1z1tlyc',
      },
    ],
    source: {
      title: 'Home Depot · OSB 7/16 in 4 × 8 ft rated sheathing, model 386081',
      url: 'https://www.homedepot.com/b/Lumber-Composites-Plywood-Oriented-Strand-Board-OSB/7-16/4-ft-x-8-ft/Rated-Sheathing/N-5yc1vZbqpqZ1z0mcpwZ1z1a6x9Z1z1tlyc',
    },
    asOf: '2026-11-24',
  },
  subfloor_23_32: {
    id: 'subfloor_23_32',
    label: 'Subfloor OSB 23/32 in T&G, 4 × 8',
    unit: 'sheet',
    searchQuery: '23/32 in x 4 ft x 8 ft OSB tongue and groove subfloor model 920924',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 23.43,
        bulkPrice: 22.26,
        bulkMinQty: 43,
        note: 'Model 920924; 23/32 in T&G 4 × 8 ft OSB; 43+ listed at $22.26 per sheet.',
        sourceUrl: 'https://www.homedepot.com/p/23-32-in-T-G-OSB-Subfloor-Common-23-32-in-x-4-ft-x-8-ft-Actual-0-703-in-x-47-875-in-x-95-875-in-920924/100054132',
      },
    ],
    source: {
      title: 'Home Depot · 23/32 in T&G OSB subfloor, model 920924',
      url: 'https://www.homedepot.com/p/23-32-in-T-G-OSB-Subfloor-Common-23-32-in-x-4-ft-x-8-ft-Actual-0-703-in-x-47-875-in-x-95-875-in-920924/100054132',
    },
    asOf: '2026-11-24',
  },
  roof_truss: {
    id: 'roof_truss',
    label: 'Roof truss, common (fink)',
    unit: 'truss',
    searchQuery: 'engineered common fink roof truss quote',
    range: null,
    offers: [],
    source: {
      title: 'Engineered roof trusses require span, pitch, loading and local supplier pricing; no generic Home Depot SKU is assumed.',
      url: 'https://www.homedepot.com/s/roof%20truss',
    },
    asOf: 'unpriced',
  },
  shingle_bundle: {
    id: 'shingle_bundle',
    label: 'Architectural shingles (33.3 sq ft bundle)',
    unit: 'bundle',
    searchQuery: 'GAF Timberline HDZ architectural shingles 33.33 sq ft bundle',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 42.97,
        bulkPrice: 38.67,
        bulkMinQty: 39,
        note: 'GAF Timberline HDZ model 0489180; 33.33 sq ft bundle; 39+ listed at $38.67 each.',
        sourceUrl: 'https://www.homedepot.com/b/Building-Materials/Bulk-Pricing/N-5yc1vZaqnsZbwo6k',
      },
    ],
    source: {
      title: 'Home Depot · GAF Timberline HDZ 33.33 sq ft bundle and bulk tier',
      url: 'https://www.homedepot.com/b/Building-Materials/Bulk-Pricing/N-5yc1vZaqnsZbwo6k',
    },
    asOf: '2026-11-10',
  },
  underlayment_roll: {
    id: 'underlayment_roll',
    label: 'Synthetic roof underlayment, 10 squares',
    unit: 'roll',
    searchQuery: 'Grip-Rite 48 in x 250 ft 1000 sq ft synthetic roofing underlayment',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 73.39,
        note: 'Grip-Rite model SL154250LWE; 48 in × 250 ft roll, 1,000 sq ft coverage.',
        sourceUrl: 'https://www.homedepot.com/p/Grip-Rite-48-in-x-250-ft-1000-sq-ft-Synthetic-Roofing-Underlayment-SL154250LWE/310301708',
      },
    ],
    source: {
      title: 'Home Depot · Grip-Rite 1,000 sq ft synthetic roofing underlayment',
      url: 'https://www.homedepot.com/p/Grip-Rite-48-in-x-250-ft-1000-sq-ft-Synthetic-Roofing-Underlayment-SL154250LWE/310301708',
    },
    asOf: '2026-11-24',
  },
  house_wrap: {
    id: 'house_wrap',
    label: 'House wrap, 9 × 150 ft',
    unit: 'roll',
    searchQuery: 'Everbilt 9 ft x 150 ft woven housewrap model KSHW09150',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 118,
        bulkPrice: 100.30,
        bulkMinQty: 5,
        note: 'Everbilt model KSHW09150; 9 × 150 ft / 1,350 sq ft roll; 5+ listed at $100.30 each.',
        sourceUrl: 'https://www.homedepot.com/b/Building-Materials-Siding/9-ft/N-5yc1vZaripZ1z0utmp',
      },
    ],
    source: {
      title: 'Home Depot · Everbilt 9 × 150 ft woven housewrap',
      url: 'https://www.homedepot.com/b/Building-Materials-Siding/9-ft/N-5yc1vZaripZ1z0utmp',
    },
    asOf: '2026-09-24',
  },
  siding_fiber_cement: {
    id: 'siding_fiber_cement',
    label: 'Fiber cement lap siding (material)',
    unit: 'sq ft',
    searchQuery: 'James Hardie fiber cement lap siding plank',
    range: null,
    offers: [],
    source: {
      title: 'Home Depot lists fiber-cement siding by board; installed exposure varies, so no unverified board-to-sq-ft conversion is used.',
      url: 'https://www.homedepot.com/b/Building-Materials-Siding-Fiber-Cement-Siding/James-Hardie/144-in/12-in/N-5yc1vZc8afZ4qrZ1z1vfzzZ1z1wa8x',
    },
    asOf: 'unpriced',
  },
  insulation_r13: {
    id: 'insulation_r13',
    label: 'R-13 fiberglass batt (walls)',
    unit: 'sq ft',
    searchQuery: 'Owens Corning R-13 faced fiberglass insulation roll 40 sq ft',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 24.97 / 40,
        bulkPrice: 21.22 / 40,
        bulkMinQty: 800,
        note: 'Owens Corning model RF10; 40 sq ft roll $24.97; 20+ rolls ($800+ sq ft) listed at $21.22 per roll.',
        sourceUrl: 'https://www.homedepot.com/p/Owens-Corning-R-13-Faced-Fiberglass-Insulation-Roll-15-in-x-32-ft-1-Roll-RF10/202585857',
      },
    ],
    source: {
      title: 'Home Depot · Owens Corning R-13 faced fiberglass insulation, 40 sq ft roll',
      url: 'https://www.homedepot.com/p/Owens-Corning-R-13-Faced-Fiberglass-Insulation-Roll-15-in-x-32-ft-1-Roll-RF10/202585857',
    },
    asOf: '2026-07-24',
  },
  insulation_attic: {
    id: 'insulation_attic',
    label: 'Attic insulation, R-30/R-38 batt or blown',
    unit: 'sq ft',
    searchQuery: 'Knauf R38 kraft faced fiberglass insulation batts 64 sq ft bag',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 90.69 / 64,
        note: 'Knauf R-38 model 5001491/814631; 64 sq ft bag listed at $90.69, normalized to $/sq ft.',
        sourceUrl: 'https://www.homedepot.com/p/303654111',
      },
    ],
    source: {
      title: 'Home Depot · Knauf R-38 fiberglass insulation, 64 sq ft bag',
      url: 'https://www.homedepot.com/p/303654111',
    },
    asOf: '2026-10-24',
  },
  drywall_1_2: {
    id: 'drywall_1_2',
    label: 'Drywall 1/2 in, 4 × 8',
    unit: 'sheet',
    searchQuery: 'USG Sheetrock UltraLight 1/2 in x 4 ft x 8 ft drywall panel',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 16.68,
        bulkPrice: 14.18,
        bulkMinQty: 34,
        note: 'USG Sheetrock UltraLight model 14113411708; 34+ sheets listed at $14.18 each.',
        sourceUrl: 'https://www.homedepot.com/p/USG-Sheetrock-Brand-1-2-in-x-4-ft-x-8-ft-USG-Sheetrock-Brand-UltraLight-Drywall-Panels-14113411708/202530243',
      },
    ],
    source: {
      title: 'Home Depot · USG Sheetrock UltraLight 1/2 in × 4 ft × 8 ft drywall',
      url: 'https://www.homedepot.com/p/USG-Sheetrock-Brand-1-2-in-x-4-ft-x-8-ft-USG-Sheetrock-Brand-UltraLight-Drywall-Panels-14113411708/202530243',
    },
    asOf: '2026-11-24',
  },
  joint_compound: {
    id: 'joint_compound',
    label: 'Joint compound, 5 gal',
    unit: 'bucket',
    searchQuery: '5 gallon premixed all purpose joint compound',
    range: null,
    offers: [],
    source: {
      title: 'Home Depot listing found is a 4.5 gal bucket, not the 5 gal unit used by this takeoff; no pack-size mismatch is priced.',
      url: 'https://www.homedepot.com/p/USG-Sheetrock-Brand-4-5-gal-Plus-3-Ready-Mixed-Joint-Compound-381466/100321602',
    },
    asOf: 'unpriced',
  },
  window_vinyl: {
    id: 'window_vinyl',
    label: 'Vinyl double-hung window, ~30 × 54 in',
    unit: 'ea',
    searchQuery: 'JELD-WEN V-2500 29.5 in x 54 in vinyl double hung window',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 329.77,
        note: 'JELD-WEN V-2500 model THDJW240200116; 29.5 × 54 in, double-pane, Low-E.',
        sourceUrl: 'https://www.homedepot.com/p/JELD-WEN-V-2500-Series-29-5-in-x-54-in-Double-Pane-Double-Hung-Vinyl-Low-E-White-Nail-Fin-Frame-Brickmould-Window-THDJW240200116/332713282',
      },
    ],
    source: {
      title: 'Home Depot · JELD-WEN V-2500 29.5 × 54 in vinyl double-hung window',
      url: 'https://www.homedepot.com/p/JELD-WEN-V-2500-Series-29-5-in-x-54-in-Double-Pane-Double-Hung-Vinyl-Low-E-White-Nail-Fin-Frame-Brickmould-Window-THDJW240200116/332713282',
    },
    asOf: '2026-09-24',
  },
  door_exterior: {
    id: 'door_exterior',
    label: 'Exterior prehung steel door, 36 × 80',
    unit: 'ea',
    searchQuery: 'Masonite 36 in x 80 in 6 panel left hand inswing primed steel prehung exterior door model 45685',
    range: null,
    offers: [
      {
        supplier: 'home_depot',
        price: 638,
        note: 'Masonite model 45685; 36 × 80 in, 6-panel, left-hand inswing, primed steel prehung with vinyl frame. Verify handing and frame spec.',
        sourceUrl: 'https://www.homedepot.com/b/Doors-Windows-Exterior-Doors-Front-Doors-Steel-Doors/36-x-80/Exterior-Prehung/Vinyl/N-5yc1vZc945Z1z0rrk7Z1z0v0mgZ1z1pnjs',
      },
    ],
    source: {
      title: 'Home Depot · Masonite 36 × 80 in 6-panel steel prehung exterior door',
      url: 'https://www.homedepot.com/b/Doors-Windows-Exterior-Doors-Front-Doors-Steel-Doors/36-x-80/Exterior-Prehung/Vinyl/N-5yc1vZc945Z1z0rrk7Z1z0v0mgZ1z1pnjs',
    },
    asOf: '2026-11-24',
  },
  door_interior: {
    id: 'door_interior',
    label: 'Interior prehung door, hollow core',
    unit: 'ea',
    searchQuery: 'prehung interior hollow core door 30 x 80',
    range: null,
    offers: [],
    source: {
      title: 'Door size, handing, slab style and frame are not fixed by the takeoff; select an exact Home Depot SKU before pricing.',
      url: 'https://www.homedepot.com/s/30%20in%20x%2080%20prehung%20interior%20hollow%20core%20door',
    },
    asOf: 'unpriced',
  },
};

const DETAILED_HOME_DEPOT_OFFERS: Partial<Record<DetailedMaterialId, {
  price: number;
  note: string;
  sourceUrl: string;
  asOf: string;
}>> = {
  electrical_nm_12_2: {
    price: 182,
    note: 'Southwire model 28828269; 250 ft 12/2 NM-B copper cable roll, listed at $182 ($0.73/ft).',
    sourceUrl: 'https://www.homedepot.com/p/202019375',
    asOf: '2026-11-24',
  },
  roof_roofing_nails: {
    price: 21,
    note: 'Grip-Rite model 114EGRFG5; 1-1/4 in, 11-gauge electrogalvanized roofing nails, 5 lb box.',
    sourceUrl: 'https://www.homedepot.com/p/100205882',
    asOf: '2026-11-17',
  },
};

/** Expanded catalog: no synthetic supplier numbers. Listings are obtained by live lookups
 * or manually entered per-item quotes, and unpriced rows do not enter estimate totals. */
export const PRICE_BOOK: Record<MaterialId, MaterialPrice> = {
  ...BASE_PRICE_BOOK,
  ...(Object.fromEntries(DETAILED_MATERIALS.map((item) => {
    const listing = DETAILED_HOME_DEPOT_OFFERS[item.id];
    return [
      item.id,
      {
        id: item.id,
        label: item.label + ' · allowance',
        unit: item.unit,
        searchQuery: item.searchQuery,
        range: null,
        offers: listing
          ? [{ supplier: 'home_depot', price: listing.price, note: listing.note, sourceUrl: listing.sourceUrl }]
          : [],
        source: listing
          ? { title: 'Home Depot listing · ' + item.label, url: listing.sourceUrl }
          : {
              title: 'No exact Home Depot base price verified; use a Home Depot lookup or enter a supplier quote.',
              url: '',
            },
        asOf: listing?.asOf ?? 'unpriced',
      } satisfies MaterialPrice,
    ];
  })) as unknown as Record<DetailedMaterialId, MaterialPrice>),
};

/** Home Depot is the only automatic base-price source. No generic or other-retailer fallback. */
export function referenceUnitPrice(
  material: MaterialPrice,
  quantity = 0,
): { price: number; seller: string; basis: 'listing' | 'typical' } | null {
  const matches = material.offers
    .filter((offer) => offer.supplier === 'home_depot')
    .map((offer) => {
      const bulk = offer.bulkPrice !== undefined &&
        offer.bulkMinQty !== undefined &&
        quantity >= offer.bulkMinQty;
      return { offer, price: bulk ? offer.bulkPrice! : offer.price, bulk };
    })
    .sort((a, b) => a.price - b.price);
  const best = matches[0];
  if (!best) return null;
  return {
    price: best.price,
    seller: best.bulk ? `Home Depot (bulk ${best.offer.bulkMinQty}+)` : 'Home Depot',
    basis: 'listing',
  };
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
  /** ISO time the provider answer was fetched; offers may be cached up to an hour. */
  fetchedAt?: string;
  /** Provider name shown next to live offers. */
  source?: string;
}
