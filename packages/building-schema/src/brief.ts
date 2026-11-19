// Brief -> preliminary design. The planner is deterministic: it extracts the program from the user's
// text, lays out a rectangular footprint, and records every assumption it made. An optional LLM
// proposer may supply a design, but its output is only accepted after HomeDesign.parse and
// checkDesign, so model output can never bypass the schema. Nothing here certifies a design.
import { HomeDesign, type BuildingElement, type Level } from './schema';
import { checkDesign, type DesignIssue } from './validate';

export interface HomeBrief {
  areaSqFt: number | null;
  levels: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garageCars: number | null;
  pool: boolean;
  solar: boolean;
  budgetUsd: number | null;
  state: string | null;
}

const STATE_CODES = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;
const STATE_NAMES: Record<string, string> = { texas: 'TX', florida: 'FL', california: 'CA', arizona: 'AZ', georgia: 'GA' };
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const NUM = String.raw`(\d+(?:,\d{3})*(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)`;

function toNumber(raw: string): number {
  const lower = raw.toLowerCase();
  if (lower in WORD_NUMBERS) return WORD_NUMBERS[lower]!;
  return Number(raw.replace(/,/g, ''));
}

function firstMatch(text: string, re: RegExp): number | null {
  const m = re.exec(text);
  return m ? toNumber(m[1]!) : null;
}

/** Extract the program from free text. Unknown fields stay null rather than being guessed. */
export function parseBrief(text: string): HomeBrief {
  const t = text.toLowerCase();
  const area = firstMatch(t, new RegExp(String.raw`${NUM}[\s-]*(?:sq\.?[\s-]*ft|square[\s-]*f(?:ee|oo)t|sqft|ft2|ft²)`));
  const levelsWord = /(one|two|three|four|1|2|3|4)[\s-]*(story|storey|level|floor)/.exec(t);
  const levels = levelsWord ? toNumber(levelsWord[1]!) : null;
  const bedrooms = firstMatch(t, new RegExp(String.raw`${NUM}\s*(?:bed(?:room)?s?|br)\b`));
  const bathrooms = firstMatch(t, new RegExp(String.raw`${NUM}\s*(?:bath(?:room)?s?|ba)\b`));
  const garage = firstMatch(t, new RegExp(String.raw`${NUM}[\s-]*(?:car)\s*garage`));
  const budgetMatch = /\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*([km])?/.exec(t);
  let budgetUsd: number | null = null;
  if (budgetMatch) {
    const base = Number(budgetMatch[1]!.replace(/,/g, ''));
    const mult = budgetMatch[2] === 'm' ? 1_000_000 : budgetMatch[2] === 'k' ? 1_000 : 1;
    budgetUsd = base * mult;
  }
  let state: string | null = null;
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (t.includes(name)) state = code;
  }
  if (!state) {
    // Case-sensitive on the original text: a lowercase "in" must not read as Indiana.
    const code = STATE_CODES.exec(text);
    state = code ? code[1]! : null;
  }
  return {
    areaSqFt: area,
    levels,
    bedrooms,
    bathrooms,
    garageCars: garage,
    pool: /\bpool\b|swimming/.test(t),
    solar: /\bsolar\b/.test(t),
    budgetUsd,
    state,
  };
}

export interface PlanResult {
  design: HomeDesign;
  brief: HomeBrief;
  assumptions: string[];
  issues: DesignIssue[];
}

const SQFT_PER_M2 = 10.763910416709722;
const LEVEL_HEIGHT_M = 3;
const ASPECT = 1.5; // width : depth of the footprint
const DOOR_WIDTH_M = 0.95;
const WINDOW_WIDTH_M = 1.2;

/**
 * Produce a preliminary, rectangular multi-level plan: exterior walls, one floor slab per level,
 * a front door on the ground floor, and one window per bedroom on the rear wall of each level.
 * `ids` supplies UUIDs so tests and callers control identity.
 */
export function planDesign(
  text: string,
  ids: { design: string; project: string; element: () => string },
  options: { name?: string; defaultAreaSqFt?: number; defaultLevels?: number; version?: number } = {},
): PlanResult {
  const brief = parseBrief(text);
  const assumptions: string[] = [];
  const areaSqFt = brief.areaSqFt ?? options.defaultAreaSqFt ?? 2500;
  if (brief.areaSqFt === null) assumptions.push(`No floor area given; assumed ${areaSqFt.toLocaleString('en-US')} sq ft.`);
  const levelCount = brief.levels ?? options.defaultLevels ?? 1;
  if (brief.levels === null) assumptions.push(`No storey count given; assumed ${levelCount}.`);
  if (brief.budgetUsd === null) assumptions.push('No construction budget given; budget recorded as $0 and must be set.');
  if (brief.bedrooms === null) assumptions.push('No bedroom count given; windows are placed for one bedroom per level.');
  if (brief.garageCars) assumptions.push(`${brief.garageCars}-car garage is recorded in the program but not yet drawn.`);
  if (brief.pool) assumptions.push('Pool and solar are recorded in the program but not drawn.');
  assumptions.push('Rectangular footprint; interior partitions, roof and MEP are not generated.');

  const footprintM2 = (areaSqFt / SQFT_PER_M2) / levelCount;
  const depth = Math.round(Math.sqrt(footprintM2 / ASPECT) * 10) / 10;
  const width = Math.round((footprintM2 / depth) * 10) / 10;

  const levels: Level[] = Array.from({ length: levelCount }, (_, i) => ({
    index: i,
    name: i === 0 ? 'Ground floor' : `Level ${i + 1}`,
    elevationM: i * LEVEL_HEIGHT_M,
    heightM: LEVEL_HEIGHT_M,
  }));

  const elements: BuildingElement[] = [];
  const bedroomsPerLevel = Math.max(1, Math.ceil((brief.bedrooms ?? 1) / levelCount));
  const corners = [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ] as const;

  for (const level of levels) {
    const wallIds: string[] = [];
    for (let side = 0; side < 4; side += 1) {
      const a = corners[side]!;
      const b = corners[(side + 1) % 4]!;
      const id = ids.element();
      wallIds.push(id);
      elements.push({
        id,
        type: 'wall',
        name: `L${level.index} ${['front', 'right', 'rear', 'left'][side]} wall`,
        level: level.index,
        start: { x: a[0], y: a[1] },
        end: { x: b[0], y: b[1] },
        heightM: level.heightM,
        thicknessM: 0.2,
      });
    }
    elements.push({
      id: ids.element(),
      type: 'floor',
      name: `L${level.index} floor slab`,
      level: level.index,
      start: { x: 0, y: 0 },
      end: { x: width, y: 0 },
      heightM: 0.2,
      thicknessM: depth,
    });
    if (level.index === 0) {
      const front = wallIds[0]!;
      elements.push({
        id: ids.element(),
        type: 'door',
        name: 'Front door',
        level: 0,
        start: { x: 0, y: 0 },
        end: { x: DOOR_WIDTH_M, y: 0 },
        heightM: 2.1,
        thicknessM: 0.2,
        hostId: front,
        widthM: DOOR_WIDTH_M,
      });
    }
    const rear = wallIds[2]!;
    for (let w = 0; w < bedroomsPerLevel; w += 1) {
      const x = ((w + 1) * width) / (bedroomsPerLevel + 1);
      elements.push({
        id: ids.element(),
        type: 'window',
        name: `L${level.index} bedroom window ${w + 1}`,
        level: level.index,
        start: { x: x - WINDOW_WIDTH_M / 2, y: depth },
        end: { x: x + WINDOW_WIDTH_M / 2, y: depth },
        heightM: 1.5,
        thicknessM: 0.2,
        hostId: rear,
        widthM: WINDOW_WIDTH_M,
      });
    }
  }

  const design = HomeDesign.parse({
    id: ids.design,
    projectId: ids.project,
    name: options.name ?? 'Preliminary home concept',
    targetAreaSqFt: areaSqFt,
    budgetCents: Math.round((brief.budgetUsd ?? 0) * 100),
    levels,
    elements,
    version: options.version ?? 1,
  });
  return { design, brief, assumptions, issues: checkDesign(design) };
}

/**
 * Accept an externally proposed design (for example from an LLM) only if it validates and passes
 * the deterministic checks with no errors. Warnings are returned, not hidden.
 */
export function acceptProposal(raw: unknown): { design: HomeDesign; issues: DesignIssue[] } {
  const design = HomeDesign.parse(raw);
  const issues = checkDesign(design);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    throw new RangeError(`Proposed design has ${errors.length} error(s): ${errors[0]!.message}`);
  }
  return { design, issues };
}
