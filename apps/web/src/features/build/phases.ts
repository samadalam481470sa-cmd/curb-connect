// Build phases for the subdivision lot plan (Plat Studio-style phasing): split the
// numbered lots into colour-coded phases, work out each phase's sales/profit from the
// same underwriting inputs as the whole deal, and map a deal month to a build stage
// for timeline playback. Pure functions only — no prices are invented here; every
// number is prorated from the builder's own deal inputs, and every output is an
// estimate. Empty or invalid inputs yield a note, never a crash.

import type { SubdivisionPlan } from './subdivision';
import { underwrite, type UnderwritingInputs, type UnderwritingResult } from './underwriting';

/** Build stage at a point in the deal timeline. */
export type BuildStage = 'paper' | 'pads' | 'vertical' | 'selling';

/** A lot whose phase has not started yet at the playback month. */
export type LotStage = BuildStage | 'not_started';

export const STAGE_LABELS: Record<BuildStage, string> = {
  paper: 'Paper lots',
  pads: 'Pads finished',
  vertical: 'Homes vertical',
  selling: 'Selling homes',
};

/**
 * Phase colours. The first five reuse colours already used by the land-feasibility
 * tool (lot passes green, buildable-area blue, parcel gold, steep orange, rule-break
 * red); the sixth is an added distinct purple so a 6-phase plan still has one colour
 * per phase.
 */
export const PHASE_COLORS = ['#3fb27f', '#8fc2ff', '#f5c451', '#f08c2e', '#e5484d', '#a78bfa'];

export const MAX_PHASES = 6;

export interface BuildPhase {
  /** 0-based phase index. */
  index: number;
  name: string;
  lotNumbers: number[];
  lotCount: number;
  color: string;
}

export interface PhasedPlan {
  phases: BuildPhase[];
  /** Total lots in the plan. */
  totalLots: number;
  /** Per-lot phase colour, keyed by lot number. Empty when there is nothing to phase. */
  lotPhaseColor: Record<number, string>;
  /** Per-lot phase index, keyed by lot number. */
  lotPhaseIndex: Record<number, number>;
  /** Human-readable note when phasing did not (fully) apply; null otherwise. */
  note: string | null;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Split a subdivision plan's lots into N phases in lot-number order, as equal as
 * possible (the first phases take one extra lot when the count does not divide
 * evenly). More phases than lots collapses to one lot per phase, with a note.
 * An empty plan or a phase count below 1 returns no phases and a note, never a crash.
 */
export function assignPhases(
  plan: SubdivisionPlan | null | undefined,
  phaseCount: number,
): PhasedPlan {
  const empty = (note: string): PhasedPlan => ({
    phases: [],
    totalLots: 0,
    lotPhaseColor: {},
    lotPhaseIndex: {},
    note,
  });
  if (!plan || plan.lots.length === 0) {
    return empty('No lots to phase yet — enter a parcel and target lot size first.');
  }
  if (!Number.isFinite(phaseCount) || Math.floor(phaseCount) < 1) {
    return {
      phases: [],
      totalLots: plan.lots.length,
      lotPhaseColor: {},
      lotPhaseIndex: {},
      note: 'Choose at least 1 phase.',
    };
  }
  const totalLots = plan.lots.length;
  const requested = Math.floor(phaseCount);
  const effective = Math.min(requested, totalLots, MAX_PHASES);
  const sorted = [...plan.lots].sort((a, b) => a.number - b.number);
  const base = Math.floor(totalLots / effective);
  const extra = totalLots % effective;
  const phases: BuildPhase[] = [];
  const lotPhaseColor: Record<number, string> = {};
  const lotPhaseIndex: Record<number, number> = {};
  let at = 0;
  for (let i = 0; i < effective; i++) {
    const count = base + (i < extra ? 1 : 0);
    const lotNumbers = sorted.slice(at, at + count).map((l) => l.number);
    at += count;
    const color = PHASE_COLORS[i % PHASE_COLORS.length]!;
    for (const n of lotNumbers) {
      lotPhaseColor[n] = color;
      lotPhaseIndex[n] = i;
    }
    phases.push({ index: i, name: `Phase ${i + 1}`, lotNumbers, lotCount: count, color });
  }
  return {
    phases,
    totalLots,
    lotPhaseColor,
    lotPhaseIndex,
    note:
      requested > effective
        ? `Only ${effective} phase${effective === 1 ? '' : 's'} fit ${totalLots} lot${totalLots === 1 ? '' : 's'} (one lot per phase).`
        : null,
  };
}

/** Whole-deal inputs that a phase's underwriting is prorated from. */
export interface PhaseDealInputs {
  land: number;
  sitework: number;
  verticalBuild: number;
  selling: number;
  hoaMonthlyPerLot: number;
  /** Lots in the whole subdivision plan (the denominator for the phase share). */
  totalLotCount: number;
  carryMonths: number;
  financing: number;
  revenue: number;
  peakEquity: number;
  durationMonths: number;
}

export interface PhaseUnderwritingResult extends UnderwritingResult {
  phaseIndex: number;
  lotCount: number;
  /** Share of the whole deal this phase represents, by lot count (0–1). */
  share: number;
  /** Phase revenue (estimate), prorated from the whole-deal revenue. */
  revenue: number;
}

/**
 * Per-phase sales/profit. Reuses underwrite() with the deal's land, sitework,
 * vertical-build, selling, interest and revenue prorated by the phase's share of
 * the lots, and HOA carried for the phase's own lot count. The null rules are
 * underwrite()'s: a phase with no cost or no equity yields null ratios, never
 * Infinity. A phase with no lots (or a deal with no lots) prorates to zero.
 */
export function phaseUnderwriting(
  phase: { index: number; lotCount: number },
  deal: PhaseDealInputs,
): PhaseUnderwritingResult {
  const totalLots = Math.max(0, Math.floor(deal.totalLotCount));
  const lotCount = Math.max(0, Math.floor(phase.lotCount));
  const share = totalLots > 0 && lotCount > 0 ? lotCount / totalLots : 0;
  const inputs: UnderwritingInputs = {
    land: nonNeg(deal.land) * share,
    sitework: nonNeg(deal.sitework) * share,
    verticalBuild: nonNeg(deal.verticalBuild) * share,
    selling: nonNeg(deal.selling) * share,
    hoaMonthlyPerLot: nonNeg(deal.hoaMonthlyPerLot),
    lotCount,
    carryMonths: nonNeg(deal.carryMonths),
    financing: nonNeg(deal.financing) * share,
    revenue: nonNeg(deal.revenue) * share,
    peakEquity: nonNeg(deal.peakEquity) * share,
    durationMonths: nonNeg(deal.durationMonths),
  };
  const result = underwrite(inputs);
  return { ...result, phaseIndex: phase.index, lotCount, share, revenue: inputs.revenue };
}

export interface PhaseTimeline {
  approvalMonths: number;
  siteWorkMonths: number;
  buildMonths: number;
  absorptionPerMonth: number;
  /** Whole deal length in months (result.months.length - 1); 0 means "derive it". */
  totalMonths: number;
  /** Lots selling through, for deriving the selling window when totalMonths is 0. */
  lotCount?: number;
}

function timelineParts(t: PhaseTimeline) {
  const approval = Math.max(0, Math.round(nonNeg(t.approvalMonths)));
  const site = Math.max(1, Math.round(nonNeg(t.siteWorkMonths)));
  const build = Math.max(0, Math.round(nonNeg(t.buildMonths)));
  const pace = Math.max(0.1, Number.isFinite(t.absorptionPerMonth) ? t.absorptionPerMonth : 0.1);
  const lotCount = Math.max(0, Math.floor(t.lotCount ?? 0));
  const sellMonths = lotCount > 0 ? Math.ceil(lotCount / pace) : 0;
  const readyAt = approval + site + build;
  const totalMonths = nonNeg(t.totalMonths) > 0 ? Math.floor(nonNeg(t.totalMonths)) : readyAt + sellMonths;
  return { approval, site, build, readyAt, totalMonths };
}

/**
 * Map a deal month to a build stage, mirroring the cash-flow timeline in
 * siteFeasibility.ts: month 0 buys the land and the approval months are paper,
 * then sitework (pads), then vertical build, then selling once homes/pads are
 * ready. Out-of-range months clamp to the deal, non-finite months read as month 0;
 * it never crashes.
 */
export function phaseStageAtMonth(month: number, timeline: PhaseTimeline): BuildStage {
  const { approval, site, readyAt, totalMonths } = timelineParts(timeline);
  const m = Number.isFinite(month)
    ? Math.min(Math.max(0, Math.floor(month)), Math.max(0, totalMonths))
    : 0;
  if (m <= approval) return 'paper';
  if (m <= approval + site) return 'pads';
  if (m <= readyAt) return 'vertical';
  return 'selling';
}

/**
 * Month a phase's work starts: phases are staggered evenly across the
 * sitework + build window, so Phase 1 starts when sitework starts (right after
 * approvals) and each later phase starts later. Before its start month a phase
 * is 'not_started'.
 */
export function phaseStartMonth(
  phaseIndex: number,
  phaseCount: number,
  timeline: PhaseTimeline,
): number {
  const { approval, site, build } = timelineParts(timeline);
  const count = Math.max(1, Math.floor(phaseCount) || 1);
  const idx = Math.min(Math.max(0, Math.floor(phaseIndex) || 0), count - 1);
  const window = site + build;
  return approval + Math.floor((idx * window) / count);
}

/** Stage of one phase's lots at a playback month: 'not_started' before its start. */
export function lotStageAtMonth(
  month: number,
  phaseIndex: number,
  phaseCount: number,
  timeline: PhaseTimeline,
): LotStage {
  if (Number.isFinite(month) && Math.floor(month) < phaseStartMonth(phaseIndex, phaseCount, timeline)) {
    return 'not_started';
  }
  return phaseStageAtMonth(month, timeline);
}
