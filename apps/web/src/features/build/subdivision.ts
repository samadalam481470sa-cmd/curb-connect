// Subdivision lot plan: a quick, simple grid/row layout from a parcel and a target lot
// size. This is a planning layout only — not a survey, not a plat, and not a zoning
// approval. It answers "about how many lots fit, and where would the roads go?" before
// the full feasibility run (siteFeasibility.ts), which checks each lot against the zoning
// rules, slopes and flood zone. Nothing here invents a price: there are no prices at all,
// only areas and counts.

export interface SubdivisionRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface SubdivisionLot {
  number: number;
  rect: SubdivisionRect;
  areaSqft: number;
  frontageFt: number;
}

export interface SubdivisionPlan {
  lots: SubdivisionLot[];
  /** The spine road, when the plan uses one; null for a single row on the street. */
  road: SubdivisionRect | null;
  /** 'spine_road' runs a street back through the middle with lots on both sides. */
  shape: 'single_row' | 'spine_road';
  rows: number;
  lotsPerRow: number;
  grossAcres: number;
  /** Roads reserve: the allowance the builder entered, in acres. */
  roadAllowanceAcres: number;
  /** The road actually drawn, in acres (a spine road at least roadWidthFt wide). */
  roadAcres: number;
  netAcres: number;
  avgLotSqft: number;
  densityLotsPerAcre: number;
  note: string;
}

export interface SubdivisionOptions {
  /** Target size of one lot, sq ft. */
  targetLotSqft: number;
  minLotWidthFt: number;
  /** Share of the parcel reserved for roads, percent. */
  roadsAllowancePct: number;
  roadWidthFt: number;
}

const SQFT_PER_ACRE = 43_560;
const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

function singleRow(
  parcel: { widthFt: number; depthFt: number },
  targetLotSqft: number,
  minLotWidthFt: number,
): { rects: SubdivisionRect[]; frontage: number } {
  const width = Math.max(minLotWidthFt, targetLotSqft / Math.max(1, parcel.depthFt));
  const count = Math.floor(parcel.widthFt / width + 1e-9);
  if (count < 1) return { rects: [], frontage: 0 };
  const w = parcel.widthFt / count; // share any leftover frontage across the lots
  const rects: SubdivisionRect[] = [];
  for (let i = 0; i < count; i++) {
    rects.push({ x0: i * w, x1: (i + 1) * w, z0: 0, z1: parcel.depthFt });
  }
  return { rects, frontage: w };
}

function spineRoad(
  parcel: { widthFt: number; depthFt: number },
  targetLotSqft: number,
  minLotWidthFt: number,
  roadWidthFt: number,
): { rects: SubdivisionRect[]; road: SubdivisionRect | null; frontage: number } {
  const roadW = Math.min(parcel.widthFt, Math.max(roadWidthFt, 0));
  const lotDepth = (parcel.widthFt - roadW) / 2;
  if (lotDepth <= 0) return { rects: [], road: null, frontage: 0 };
  const width = Math.max(minLotWidthFt, targetLotSqft / lotDepth);
  const perSide = Math.floor(parcel.depthFt / width + 1e-9);
  if (perSide < 1) return { rects: [], road: null, frontage: 0 };
  const w = parcel.depthFt / perSide;
  const road: SubdivisionRect = {
    x0: (parcel.widthFt - roadW) / 2,
    x1: (parcel.widthFt + roadW) / 2,
    z0: 0,
    z1: parcel.depthFt,
  };
  const rects: SubdivisionRect[] = [];
  for (let i = 0; i < perSide; i++) {
    rects.push({ x0: 0, x1: road.x0, z0: i * w, z1: (i + 1) * w });
    rects.push({ x0: road.x1, x1: parcel.widthFt, z0: i * w, z1: (i + 1) * w });
  }
  return { rects, road, frontage: w };
}

/**
 * Lay out a numbered lot plan for a parcel. Picks whichever simple shape fits more lots
 * (ties go to the single row, which needs no new street), then caps the count at what
 * the net area after the roads allowance can hold at the target lot size. Zero or
 * missing inputs yield an empty plan with a note, never a crash or a made-up count.
 */
export function planSubdivision(
  parcel: { widthFt: number; depthFt: number },
  opts: SubdivisionOptions,
): SubdivisionPlan {
  const widthFt = nonNeg(parcel.widthFt);
  const depthFt = nonNeg(parcel.depthFt);
  const targetLotSqft = nonNeg(opts.targetLotSqft);
  const minLotWidthFt = nonNeg(opts.minLotWidthFt);
  const roadsAllowancePct = Math.min(90, Math.max(0, Number.isFinite(opts.roadsAllowancePct) ? opts.roadsAllowancePct : 0));
  const roadWidthFt = nonNeg(opts.roadWidthFt);
  const grossSqft = widthFt * depthFt;
  const grossAcres = grossSqft / SQFT_PER_ACRE;
  const roadAllowanceAcres = (grossSqft * roadsAllowancePct) / 100 / SQFT_PER_ACRE;
  const empty = (note: string): SubdivisionPlan => ({
    lots: [],
    road: null,
    shape: 'single_row',
    rows: 0,
    lotsPerRow: 0,
    grossAcres,
    roadAllowanceAcres,
    roadAcres: 0,
    netAcres: grossAcres - roadAllowanceAcres,
    avgLotSqft: 0,
    densityLotsPerAcre: 0,
    note,
  });
  if (widthFt <= 0 || depthFt <= 0) return empty('Enter a parcel size first.');
  if (targetLotSqft <= 0) return empty('Enter a target lot size first.');
  if (minLotWidthFt <= 0) return empty('Enter a minimum lot width first.');

  // The spine road is drawn at least roadWidthFt wide; if the roads allowance implies a
  // wider street, widen it to match the allowance.
  const allowanceRoadW = (grossSqft * roadsAllowancePct) / 100 / Math.max(1, depthFt);
  const row = singleRow({ widthFt, depthFt }, targetLotSqft, minLotWidthFt);
  const spine = spineRoad(
    { widthFt, depthFt },
    targetLotSqft,
    minLotWidthFt,
    Math.max(roadWidthFt, allowanceRoadW),
  );
  const useSpine = spine.rects.length > row.rects.length;
  const shape = useSpine ? 'spine_road' : 'single_row';
  const geometric = useSpine ? spine.rects : row.rects;
  const netSqft = grossSqft * (1 - roadsAllowancePct / 100);
  const areaCap = Math.floor(netSqft / targetLotSqft + 1e-9);
  const count = Math.min(geometric.length, areaCap);
  if (count < 1) {
    return empty(
      'No lot fits at this target size on this parcel. Use a smaller lot size, a wider parcel, or a smaller roads allowance.',
    );
  }
  const road = useSpine ? spine.road : null;
  const roadSqft = road ? (road.x1 - road.x0) * (road.z1 - road.z0) : 0;
  const picked = geometric.slice(0, count);
  const lots: SubdivisionLot[] = picked.map((rect, i) => ({
    number: i + 1,
    rect,
    areaSqft: (rect.x1 - rect.x0) * (rect.z1 - rect.z0),
    frontageFt: useSpine ? rect.z1 - rect.z0 : rect.x1 - rect.x0,
  }));
  const avgLotSqft = lots.reduce((s, l) => s + l.areaSqft, 0) / lots.length;
  const lotsPerRow = useSpine ? Math.ceil(count / 2) : count;
  return {
    lots,
    road,
    shape,
    rows: useSpine ? 2 : 1,
    lotsPerRow,
    grossAcres,
    roadAllowanceAcres,
    roadAcres: roadSqft / SQFT_PER_ACRE,
    netAcres: (grossSqft - roadSqft) / SQFT_PER_ACRE,
    avgLotSqft,
    densityLotsPerAcre: grossAcres > 0 ? count / grossAcres : 0,
    note:
      shape === 'spine_road'
        ? `A new street runs back through the middle with lots on both sides (${lotsPerRow} per side). Planning layout — not a survey or plat.`
        : 'One row of lots on the existing street. Planning layout — not a survey or plat.',
  };
}
