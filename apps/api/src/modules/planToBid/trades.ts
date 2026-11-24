// Plan-to-Bid trade taxonomy (build sequence) and the deterministic plan-text reader.
//
// The reader only reports what the plan actually says: a keyword match produces a draft line
// with the matched words as evidence and a null quantity unless the plan states one. It never
// invents quantities, prices or items. Anything the AI classifies is validated separately
// (plan-ai.ts) and marked source 'ai'.
import {
  PLAN_TO_BID_TRADE_LABELS,
  PLAN_TO_BID_TRADES,
  type PlanToBidDraftLine,
  type PlanToBidTrade,
} from '@fieldline/contracts';

export { PLAN_TO_BID_TRADE_LABELS, PLAN_TO_BID_TRADES };

/** Keyword rules per trade. `label` is the draft line shown to the reviewer. */
export interface TradeKeywordRule {
  trade: PlanToBidTrade;
  label: string;
  unit: string;
  /** Word-boundary regexes matched against the plan text (case-insensitive). */
  patterns: RegExp[];
}

export const TRADE_KEYWORD_RULES: readonly TradeKeywordRule[] = [
  {
    trade: 'sitework',
    label: 'Erosion control / silt fence',
    unit: 'LF',
    patterns: [/\bsilt fence\b/i, /\berosion control\b/i],
  },
  {
    trade: 'sitework',
    label: 'Site layout / survey staking',
    unit: 'ls',
    patterns: [/\bsurvey\b/i, /\bstaking\b/i, /\blayout stakes?\b/i],
  },
  {
    trade: 'sitework',
    label: 'Landscaping / sod',
    unit: 'ls',
    patterns: [/\blandscap\w*\b/i, /\bsod\b/i, /\btopsoil\b/i, /\birrigation\b/i],
  },
  {
    trade: 'excavation',
    label: 'Excavation / earthwork',
    unit: 'CY',
    patterns: [/\bexcavat\w*\b/i, /\bearthwork\b/i, /\bcut and fill\b/i, /\bbackfill\b/i],
  },
  {
    trade: 'excavation',
    label: 'Trenching',
    unit: 'LF',
    patterns: [/\btrench\w*\b/i],
  },
  {
    trade: 'excavation',
    label: 'Grading',
    unit: 'SF',
    patterns: [/\bgrading\b/i, /\bgrade (the )?site\b/i],
  },
  {
    trade: 'foundations',
    label: 'Footings',
    unit: 'LF',
    patterns: [/\bfooting\w*\b/i],
  },
  {
    trade: 'foundations',
    label: 'Concrete slab',
    unit: 'CY',
    patterns: [/\bslab\b/i, /\bconcrete slab\b/i],
  },
  {
    trade: 'foundations',
    label: 'Foundation / piers',
    unit: 'ls',
    patterns: [/\bfoundation\b/i, /\bpiers?\b/i, /\bgrade beam\b/i, /\bstem wall\b/i],
  },
  {
    trade: 'foundations',
    label: 'Ready-mix concrete',
    unit: 'CY',
    patterns: [/\bready[- ]?mix\b/i, /\b3000 psi\b/i, /\b4000 psi\b/i],
  },
  {
    trade: 'underground_plumbing',
    label: 'Underground sewer / sanitary',
    unit: 'LF',
    patterns: [/\bunderground (plumbing|sewer|sanitary)\b/i, /\bsanitary sewer\b/i, /\bsewer (main|line)\b/i],
  },
  {
    trade: 'underground_plumbing',
    label: 'Underground water / drain lines',
    unit: 'LF',
    patterns: [/\bwater main\b/i, /\bdrain (line|pipe)\b/i, /\bunderground drain\b/i],
  },
  {
    trade: 'rebar_vapor',
    label: 'Rebar / reinforcing steel',
    unit: 'ea',
    patterns: [/\brebar\b/i, /\breinforcing (steel|bar)\b/i, /\b#4 bar\b/i, /\b#5 bar\b/i, /\bwire mesh\b/i],
  },
  {
    trade: 'rebar_vapor',
    label: 'Vapor barrier / retarder',
    unit: 'SF',
    patterns: [/\bvapor barrier\b/i, /\bvapor retarder\b/i, /\b6 mil (poly|vapor)\b/i],
  },
  {
    trade: 'structural_steel',
    label: 'Structural steel beams / columns',
    unit: 'ls',
    patterns: [/\bstructural steel\b/i, /\bsteel beam\b/i, /\bI-?beam\b/i, /\bmoment frame\b/i],
  },
  {
    trade: 'framing',
    label: 'Wall framing / studs',
    unit: 'LF',
    patterns: [/\bframing\b/i, /\bstuds?\b/i, /\bwall framing\b/i],
  },
  {
    trade: 'framing',
    label: 'Floor / roof joists and trusses',
    unit: 'ea',
    patterns: [/\bjoists?\b/i, /\btrusses?\b/i, /\bheaders?\b/i],
  },
  {
    trade: 'framing',
    label: 'Sheathing / lumber',
    unit: 'SF',
    patterns: [/\bsheathing\b/i, /\blumber\b/i],
  },
  {
    trade: 'roofing',
    label: 'Roofing / shingles',
    unit: 'sq',
    patterns: [/\broofing\b/i, /\bshingle\w*\b/i, /\broof (deck|covering)\b/i],
  },
  {
    trade: 'roofing',
    label: 'Underlayment / flashing / gutters',
    unit: 'LF',
    patterns: [/\bunderlayment\b/i, /\bflashing\b/i, /\bgutter\w*\b/i, /\bdownspout\w*\b/i],
  },
  {
    trade: 'envelope',
    label: 'Siding / stucco / brick veneer',
    unit: 'SF',
    patterns: [/\bsiding\b/i, /\bstucco\b/i, /\bbrick veneer\b/i, /\bmasonry veneer\b/i],
  },
  {
    trade: 'envelope',
    label: 'Windows and exterior doors',
    unit: 'ea',
    patterns: [/\bwindow schedule\b/i, /\bexterior doors?\b/i, /\bhouse ?wrap\b/i],
  },
  {
    trade: 'envelope',
    label: 'Insulation',
    unit: 'SF',
    patterns: [/\binsulation\b/i, /\bR-?13\b/i, /\bR-?19\b/i, /\bspray foam\b/i],
  },
  {
    trade: 'electrical',
    label: 'Electrical panel / circuits',
    unit: 'ls',
    patterns: [/\belectrical panel\b/i, /\bservice panel\b/i, /\bcircuit\w*\b/i],
  },
  {
    trade: 'electrical',
    label: 'Wiring / outlets / lighting',
    unit: 'ls',
    patterns: [/\bwiring\b/i, /\boutlet\w*\b/i, /\blighting\b/i, /\bconduit\b/i],
  },
  {
    trade: 'plumbing',
    label: 'Plumbing fixtures',
    unit: 'ea',
    patterns: [/\bplumbing fixture\w*\b/i, /\bwater heater\b/i, /\bfaucet\w*\b/i, /\btoilet\w*\b/i],
  },
  {
    trade: 'plumbing',
    label: 'Plumbing rough-in (above ground)',
    unit: 'LF',
    patterns: [/\bplumbing rough\b/i, /\bPEX\b/, /\bcopper pipe\b/i, /\bDWV\b/],
  },
  {
    trade: 'hvac',
    label: 'HVAC equipment',
    unit: 'ls',
    patterns: [/\bHVAC\b/, /\bfurnace\b/i, /\bair handler\b/i, /\bcondenser\b/i, /\bmini[- ]?split\b/i],
  },
  {
    trade: 'hvac',
    label: 'Ductwork / ventilation',
    unit: 'LF',
    patterns: [/\bductwork\b/i, /\bduct\w*\b/i, /\bventilation\b/i],
  },
  {
    trade: 'interior_finishes',
    label: 'Drywall / paint',
    unit: 'SF',
    patterns: [/\bdrywall\b/i, /\bpaint\b/i, /\bjoint compound\b/i],
  },
  {
    trade: 'interior_finishes',
    label: 'Flooring / tile',
    unit: 'SF',
    patterns: [/\bflooring\b/i, /\btile\b/i, /\bhardwood floor\b/i],
  },
  {
    trade: 'interior_finishes',
    label: 'Cabinets / countertops / trim',
    unit: 'ls',
    patterns: [/\bcabinet\w*\b/i, /\bcountertop\w*\b/i, /\btrim\b/i, /\bbaseboard\w*\b/i],
  },
  {
    trade: 'exterior_finishes',
    label: 'Driveway / walkways / patio',
    unit: 'SF',
    patterns: [/\bdriveway\b/i, /\bwalkway\w*\b/i, /\bpatio\b/i, /\bdeck\b/i],
  },
  {
    trade: 'exterior_finishes',
    label: 'Fence / retaining wall',
    unit: 'LF',
    patterns: [/\bfence\b/i, /\bretaining wall\b/i],
  },
];

const MAX_EVIDENCE = 200;
const MAX_LINES = 60;

/** A short quote around the first match, so the reviewer can see where the line came from. */
export function evidenceSnippet(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - 60);
  const end = Math.min(text.length, matchIndex + matchLength + 60);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return snippet.length > MAX_EVIDENCE ? `${snippet.slice(0, MAX_EVIDENCE)}…` : snippet;
}

/**
 * Reads plan text into one draft line per matched keyword rule. Quantity is always null:
 * a keyword says the item is on the plan, not how much of it there is. Lines come back in
 * build-sequence order.
 */
export function classifyPlanText(text: string): PlanToBidDraftLine[] {
  if (!text || !text.trim()) return [];
  const lines: PlanToBidDraftLine[] = [];
  for (const rule of TRADE_KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      const match = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`).exec(text);
      if (!match || match.index === undefined) continue;
      lines.push({
        trade: rule.trade,
        label: rule.label,
        unit: rule.unit,
        quantity: null,
        source: 'plan_text',
        evidence: evidenceSnippet(text, match.index, match[0].length),
        confidence: 0.6,
      });
      break; // One line per rule, even if the keyword appears many times.
    }
    if (lines.length >= MAX_LINES) break;
  }
  const order = new Map(PLAN_TO_BID_TRADES.map((t, i) => [t, i]));
  return lines.sort((a, b) => (order.get(a.trade) ?? 99) - (order.get(b.trade) ?? 99));
}
