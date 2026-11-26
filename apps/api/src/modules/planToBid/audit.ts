// Plan audit (AI Architecture reel, tool #5 idea: auto-tagging/audit agent for uploaded plans).
//
// Pure checks over what the deterministic reader already produced: the measured geometry, the
// plan text, and the tagged draft lines. The audit never invents quantities or prices; it
// reports what the plan names, what it does not name, and where the two disagree. Real element
// detection (fixtures, symbols, details in a scan) needs a vision model and is NOT claimed
// here — the findings say what was actually checked.
import {
  PLAN_TO_BID_TRADE_LABELS,
  PLAN_TO_BID_TRADES,
  type PlanAuditFinding,
  type PlanGeometryReading,
  type PlanToBidDraftLine,
} from '@fieldline/contracts';
import { evidenceSnippet } from './trades';

export interface PlanAuditInput {
  geometry: PlanGeometryReading | null;
  planText: string;
  lines: readonly PlanToBidDraftLine[];
}

const STATED_AREA = /\b(\d[\d,]{2,6})\s*(?:SF|SQ\.?\s*FT|SQUARE\s+FEET)\b/i;
const DOOR_SCHEDULE = /\bdoor schedule\b/i;
const WINDOW_SCHEDULE = /\bwindow schedule\b/i;

/** Run the audit checks. Findings come back problems first, then notes. */
export function auditPlan(input: PlanAuditInput): PlanAuditFinding[] {
  const { geometry, planText, lines } = input;
  const findings: PlanAuditFinding[] = [];
  let seq = 0;
  const add = (f: Omit<PlanAuditFinding, 'id'>) => findings.push({ ...f, id: `audit-${(seq += 1)}` });

  const hasText = planText.trim().length > 0;

  if (!hasText) {
    add({
      severity: 'note',
      trade: null,
      title: 'No readable text layer',
      detail:
        'This file has no text the reader could extract, so keyword tagging could not run. Only measured lines were tagged. A PDF exported from CAD (not a scan) carries its labels as text.',
      evidence: null,
    });
  }
  if (!geometry) {
    add({
      severity: 'note',
      trade: null,
      title: 'No walls or rooms could be measured',
      detail:
        'The drawn lines did not yield a footprint or labeled rooms, so nothing was measured. Tags below come from the plan text only, and quantities stay blank until measured.',
      evidence: null,
    });
  }

  // Trades the plan text never names (only meaningful when there is text to check).
  if (hasText) {
    const taggedTrades = new Set(lines.map((l) => l.trade));
    for (const trade of PLAN_TO_BID_TRADES) {
      if (!taggedTrades.has(trade)) {
        add({
          severity: 'note',
          trade,
          title: `No ${PLAN_TO_BID_TRADE_LABELS[trade]} items named`,
          detail: `The plan text names no ${PLAN_TO_BID_TRADE_LABELS[trade]} work. If this trade is in scope, it is not on this sheet — check the specs or the other sheets before bidding.`,
          evidence: null,
        });
      }
    }
  }

  // Tagged items without quantities.
  const unquantified = lines.filter((l) => l.quantity === null);
  if (unquantified.length > 0) {
    add({
      severity: 'note',
      trade: null,
      title: `${unquantified.length} tagged item${unquantified.length === 1 ? '' : 's'} without quantities`,
      detail:
        'These items are named on the plan but the plan states no quantity for them, so they are tagged with a blank quantity. Measure or count them before pricing — the audit does not guess quantities.',
      evidence: unquantified[0]?.evidence ?? null,
    });
  }

  if (geometry) {
    if (geometry.confidence < 0.5) {
      add({
        severity: 'problem',
        trade: null,
        title: 'Measured outline is low-confidence',
        detail: `The drawing reader's overall confidence is ${geometry.confidence.toFixed(2)} (below 0.50), so the measured outline and rooms are a starting point only. Verify the dimensions against the sheet before using them.`,
        evidence: null,
      });
    }
    if (geometry.scale.source === 'none') {
      add({
        severity: 'problem',
        trade: null,
        title: 'No drawing scale found',
        detail:
          'No scale note or dimension string set the drawing scale, so measured lengths may be off. Confirm the scale on the sheet before trusting any measured value.',
        evidence: null,
      });
    }
    const unlabeled = geometry.rooms.filter((r) => !r.name.trim());
    if (unlabeled.length > 0) {
      add({
        severity: 'note',
        trade: null,
        title: `${unlabeled.length} measured room${unlabeled.length === 1 ? '' : 's'} without a label`,
        detail:
          'Room outlines were measured but carry no label on the sheet, so they cannot be matched to the program. Label them on the plan or identify them in review.',
        evidence: null,
      });
    }
    const names = geometry.rooms.map((r) => r.name.trim().toLowerCase()).filter(Boolean);
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    if (dupes.length > 0) {
      add({
        severity: 'note',
        trade: null,
        title: 'Duplicate room labels',
        detail: `These room labels appear more than once: ${dupes.join(', ')}. Check whether they are separate rooms or the same room read twice.`,
        evidence: null,
      });
    }
    if (hasText && geometry.doors > 0 && !DOOR_SCHEDULE.test(planText)) {
      add({
        severity: 'note',
        trade: 'envelope',
        title: 'Door swings measured, no door schedule found',
        detail: `${geometry.doors} door swing${geometry.doors === 1 ? '' : 's'} were measured from the drawn lines, but the plan text has no door schedule. Door sizes and hardware are not stated on this sheet.`,
        evidence: null,
      });
    }
    if (hasText && geometry.windows > 0 && !WINDOW_SCHEDULE.test(planText)) {
      add({
        severity: 'note',
        trade: 'envelope',
        title: 'Windows measured, no window schedule found',
        detail: `${geometry.windows} window${geometry.windows === 1 ? '' : 's'} were measured from the drawn lines, but the plan text has no window schedule. Window sizes and types are not stated on this sheet.`,
        evidence: null,
      });
    }
    // Stated area vs measured outline (conservative: only flag clear disagreement).
    if (hasText && geometry.footprint) {
      const m = STATED_AREA.exec(planText);
      if (m) {
        const stated = Number(m[1]!.replace(/,/g, ''));
        const outline = geometry.footprint.lengthFt * geometry.footprint.widthFt;
        const stories = geometry.stories ?? 1;
        const expected = outline * stories;
        if (Number.isFinite(stated) && stated > 0 && (stated < expected * 0.7 || stated > expected * 1.4)) {
          add({
            severity: 'problem',
            trade: null,
            title: 'Stated area disagrees with the measured outline',
            detail: `The plan text states ${stated.toLocaleString('en-US')} sq ft, but the measured outline is ${geometry.footprint.lengthFt} × ${geometry.footprint.widthFt} ft (${Math.round(outline).toLocaleString('en-US')} sq ft per floor${stories > 1 ? `, ${stories} floors` : ''}). One of them is wrong — verify before pricing.`,
            evidence: evidenceSnippet(planText, m.index, m[0].length),
          });
        }
      }
    }
  }

  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'problem' ? -1 : 1));
}
