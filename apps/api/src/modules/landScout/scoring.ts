// Land Scout scoring: appraisal use 30%, size 25%, infrastructure 25%, price 20%.
// Missing data scores as unknown (null) and is excluded with the weights renormalized —
// never silently zero. The CAD layers publish appraisal use/class, not municipal zoning,
// so the use factor is labeled that way everywhere it is shown. Infrastructure averages
// highway, substation and (when it matters for the buy box) freight-rail proximity.
import type { BuyBox, LandParcel, LandScore, LandUseType, ScoreFactor } from '@fieldline/contracts';

export type UseCategory =
  | 'industrial'
  | 'commercial'
  | 'multifamily'
  | 'residential'
  | 'vacant'
  | 'agricultural'
  | 'utility'
  | 'exempt'
  | 'unknown';

/**
 * Classify a CAD appraisal use/class into a coarse category. Collin publishes Texas state
 * category codes (F2 industrial, F1/F3 commercial, B multifamily, A residential, C vacant,
 * D/E agricultural, J utility); Dallas publishes class text. Anything unrecognized stays
 * 'unknown' rather than being guessed.
 */
export function classifyUse(appraisalUse: string | null): UseCategory {
  if (!appraisalUse) return 'unknown';
  const raw = appraisalUse.trim().toUpperCase();
  if (!raw) return 'unknown';
  // Texas state category codes (Collin landTypeCode / propUseCode prefixes).
  if (/^F2/.test(raw)) return 'industrial';
  if (/^F[13]/.test(raw) || /^F\d/.test(raw)) return 'commercial';
  if (/^B\d/.test(raw) || raw === 'B') return 'multifamily';
  if (/^A\d/.test(raw) || raw === 'A') return 'residential';
  if (/^C\d/.test(raw) || raw === 'C') return 'vacant';
  if (/^[DE]\d/.test(raw) || raw === 'D' || raw === 'E') return 'agricultural';
  if (/^J\d/.test(raw) || raw === 'J') return 'utility';
  if (/EXEMPT/.test(raw)) return 'exempt';
  // Dallas class text and other free text.
  if (/INDUSTRIAL|MANUFACTURING|WAREHOUSE/.test(raw)) return 'industrial';
  if (/COMMERCIAL|RETAIL|OFFICE/.test(raw)) return 'commercial';
  if (/MULTI|APARTMENT/.test(raw)) return 'multifamily';
  if (/RESIDENTIAL|SINGLE FAMILY|DUPLEX/.test(raw)) return 'residential';
  if (/VACANT/.test(raw)) return 'vacant';
  if (/AGRICULT|FARM|RANCH|OPEN SPACE/.test(raw)) return 'agricultural';
  if (/UTILIT/.test(raw)) return 'utility';
  return 'unknown';
}

const COMPATIBLE: Record<Exclude<LandUseType, 'any'>, UseCategory[]> = {
  industrial: ['industrial'],
  warehouse: ['industrial', 'commercial'],
  data_center: ['industrial', 'utility'],
  multifamily: ['multifamily'],
  self_storage: ['commercial', 'industrial'],
  single_family: ['residential', 'vacant'],
};

export function scoreUse(parcel: LandParcel, buyBox: BuyBox): ScoreFactor {
  const weight = 0.3;
  const category = classifyUse(parcel.appraisalUse);
  if (buyBox.zoning && parcel.appraisalUse) {
    if (parcel.appraisalUse.toLowerCase().includes(buyBox.zoning.toLowerCase())) {
      return { score: 100, weight, detail: `Appraisal use matches "${buyBox.zoning}" (not city zoning — confirm with the city).` };
    }
  }
  if (category === 'unknown') {
    return { score: null, weight, detail: 'Appraisal use not published or not recognized — use not scored.' };
  }
  if (buyBox.useType === 'any') {
    return { score: 100, weight, detail: `Any use accepted; appraisal use is ${category}.` };
  }
  if (COMPATIBLE[buyBox.useType].includes(category)) {
    return { score: 100, weight, detail: `Appraisal use (${category}) fits ${buyBox.useType.replace('_', ' ')}.` };
  }
  if (category === 'agricultural' || category === 'vacant') {
    return { score: 50, weight, detail: `Appraisal use is ${category} — development may need rezoning; confirm with the city.` };
  }
  if (category === 'exempt') {
    return { score: 0, weight, detail: 'Exempt owner/use (often government or nonprofit) — usually not developable.' };
  }
  return { score: 0, weight, detail: `Appraisal use (${category}) does not fit ${buyBox.useType.replace('_', ' ')}.` };
}

export function scoreSize(parcel: LandParcel, buyBox: BuyBox): ScoreFactor {
  const weight = 0.25;
  if (parcel.acres === null || parcel.acres <= 0) {
    return { score: null, weight, detail: 'Acreage not published — size not scored.' };
  }
  const { acresMin: min, acresMax: max } = buyBox;
  if (min === null && max === null) {
    return { score: 100, weight, detail: `${parcel.acres} acres; no size limits in the buy box.` };
  }
  const lo = min ?? 0;
  const hi = max ?? Number.POSITIVE_INFINITY;
  if (parcel.acres >= lo && parcel.acres <= hi) {
    return { score: 100, weight, detail: `${parcel.acres} acres is inside the buy-box range.` };
  }
  const bound = parcel.acres < lo ? lo : hi;
  const offBy = bound > 0 && Number.isFinite(bound) ? Math.abs(parcel.acres - bound) / bound : 1;
  if (offBy <= 0.2) {
    return { score: 50, weight, detail: `${parcel.acres} acres is within 20% of the buy-box range.` };
  }
  return { score: 0, weight, detail: `${parcel.acres} acres is outside the buy-box range.` };
}

export function scoreInfrastructure(parcel: LandParcel, buyBox: BuyBox): ScoreFactor {
  const weight = 0.25;
  const parts: { score: number; label: string }[] = [];
  const notes: string[] = [];
  if (parcel.highwayMiles !== null) {
    const m = parcel.highwayMiles;
    let s: number;
    if (buyBox.maxHighwayMiles !== null && buyBox.maxHighwayMiles > 0) {
      s = m <= buyBox.maxHighwayMiles ? 100 : m <= buyBox.maxHighwayMiles * 1.5 ? 50 : 0;
    } else {
      s = m <= 1 ? 100 : m <= 3 ? 50 : m <= 5 ? 25 : 0;
    }
    parts.push({ score: s, label: `highway ${m.toFixed(1)} mi${parcel.highwayName ? ` (${parcel.highwayName})` : ''}` });
  } else {
    notes.push('highway distance unknown');
  }
  if (parcel.substationMiles !== null) {
    const m = parcel.substationMiles;
    const s = m <= 2 ? 100 : m <= 5 ? 50 : 0;
    parts.push({
      score: s,
      label: `substation ${m.toFixed(1)} mi${parcel.substationKv ? ` (${parcel.substationKv} kV)` : ''}`,
    });
  } else if (buyBox.needsPower) {
    notes.push('substation distance unknown (power required)');
  }
  // Freight rail matters for warehouse / industrial sites and whenever the buyer asked
  // for rail access. It is a part of infrastructure only then — a data-center or
  // single-family search is not penalized for being far from a rail line.
  const railMatters = buyBox.needsRail || buyBox.useType === 'warehouse' || buyBox.useType === 'industrial';
  if (parcel.railroadMiles !== null && railMatters) {
    const m = parcel.railroadMiles;
    const s = m <= 1 ? 100 : m <= 2 ? 50 : m <= 5 ? 25 : 0;
    parts.push({
      score: s,
      label: `rail ${m.toFixed(1)} mi${parcel.railroadName ? ` (${parcel.railroadName})` : ''}`,
    });
  } else if (buyBox.needsRail) {
    notes.push('rail distance unknown (rail required)');
  }
  if (buyBox.needsWater || buyBox.needsSewer) {
    notes.push('water/sewer availability is not in CAD data — confirm with the city/utility');
  }
  if (parts.length === 0) {
    return { score: null, weight, detail: `Infrastructure not scored: ${notes.join('; ') || 'no distance data'}.` };
  }
  const score = Math.round(parts.reduce((a, p) => a + p.score, 0) / parts.length);
  const detail = parts.map((p) => p.label).join('; ') + (notes.length ? `; ${notes.join('; ')}` : '');
  return { score, weight, detail };
}

export function pricePerAcre(parcel: LandParcel): number | null {
  if (parcel.landValue === null || parcel.acres === null || parcel.acres <= 0) return null;
  return parcel.landValue / parcel.acres;
}

export function scorePrice(parcel: LandParcel, buyBox: BuyBox): ScoreFactor {
  const weight = 0.2;
  const ppa = pricePerAcre(parcel);
  if (ppa === null) {
    return { score: null, weight, detail: 'No CAD land value published — price not scored (no comp data).' };
  }
  const shown = `$${Math.round(ppa).toLocaleString('en-US')}/acre (CAD land value)`;
  if (buyBox.maxPricePerAcre === null) {
    return { score: 100, weight, detail: `${shown}; no price cap in the buy box.` };
  }
  if (ppa <= buyBox.maxPricePerAcre) return { score: 100, weight, detail: `${shown} is at or under the cap.` };
  if (ppa <= buyBox.maxPricePerAcre * 1.25) return { score: 50, weight, detail: `${shown} is within 25% over the cap.` };
  return { score: 0, weight, detail: `${shown} is over the cap.` };
}

export function scoreParcel(parcel: LandParcel, buyBox: BuyBox): LandScore {
  const factors = {
    use: scoreUse(parcel, buyBox),
    size: scoreSize(parcel, buyBox),
    infrastructure: scoreInfrastructure(parcel, buyBox),
    price: scorePrice(parcel, buyBox),
  };
  const known = Object.values(factors).filter((f) => f.score !== null);
  const totalWeight = known.reduce((a, f) => a + f.weight, 0);
  const total =
    known.length === 0 || totalWeight === 0
      ? null
      : Math.round(known.reduce((a, f) => a + (f.score ?? 0) * f.weight, 0) / totalWeight);
  return { total, factorsKnown: known.length, ...factors };
}

/** Rank parcels by total score (unknown totals last), best first. */
export function rankParcels<T extends { score: LandScore }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = a.score.total ?? -1;
    const tb = b.score.total ?? -1;
    if (tb !== ta) return tb - ta;
    return b.score.factorsKnown - a.score.factorsKnown;
  });
}

const ENTITY_WORDS = /\b(LLC|L\.L\.C\.|LTD|INC|CORP|CORPORATION|LP|L\.P\.|LLP|COMPANY|CO\.|PARTNERSHIP|TRUST|HOLDINGS|PROPERTIES|VENTURES|GROUP)\b/i;

/** True when the owner name looks like a company/entity (SOSDirect lookup applies). */
export function ownerIsEntity(ownerName: string | null): boolean {
  return ownerName !== null && ENTITY_WORDS.test(ownerName);
}

/**
 * Owner signals derived only from the CAD fields already fetched — the same idea as the
 * "motivated seller" signals in the land-acquisition-intel skill, but nothing here is
 * invented: an out-of-state owner is read from the mailing address state, and an
 * estate/trust is read from the owner name. Tax-delinquency and hold length are not in
 * CAD data, so they are never claimed.
 */
export function ownerSignals(parcel: LandParcel): string[] {
  const signals: string[] = [];
  if (parcel.ownerName && /\b(ESTATE|TRUST|TRUSTEE|EXECUTOR)\b/i.test(parcel.ownerName)) {
    signals.push('Owner name suggests an estate or trust');
  }
  if (parcel.ownerMailing) {
    // Mailing addresses are "street, CITY ST ZIP" — the state is the two-letter token
    // right before the ZIP at the end (no comma between city and state in CAD data).
    const match = parcel.ownerMailing.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/i);
    const state = match?.[1]?.toUpperCase();
    if (state && state !== 'TX') {
      signals.push(`Out-of-state owner (mailing address in ${state})`);
    }
  }
  return signals;
}

/** Plain-language development-suitability label for a ranked score (Land Scout + report). */
export function suitabilityLabel(total: number | null): string {
  if (total === null) return 'Not enough data to score';
  if (total >= 80) return 'Strong fit';
  if (total >= 60) return 'Good fit';
  if (total >= 40) return 'Possible fit — verify';
  return 'Weak fit';
}
