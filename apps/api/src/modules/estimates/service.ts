// Shared estimate engine glue for roof and curb (CP-052, CP-057, CP-058, CP-059, OPS-065, ADD-060).
// A revision is a frozen, insert-only snapshot: inputs (with provenance), line specs, site
// conditions, the complete price-book revision snapshot + selection disclosure, engine versions,
// priced lines, low/base/high scenarios, gating result and binding flag. The same inputs and the
// same price-book revision always produce the same revision content (deterministic repricing).
import { createHash } from 'node:crypto';
import {
  CURB_SITE_CONDITION_KEYS,
  type EstimateLineSpec,
  type EstimateStatus,
  estimateMachine,
  type GatingResult,
  isTrusted,
  type Measurement,
  type PriceSelection,
  type ProductLine,
  type SignoffRole,
  type SiteCondition,
} from '@fieldline/contracts';
import {
  type Bounded,
  type CostCategory,
  type CostLineInput,
  convertQuantity,
  type Currency,
  ENGINE_VERSION,
  type EstimateResult,
  priceEstimate,
  type QuantityUnit,
} from '@fieldline/pricing';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { curbProjects, estimateRevisions, estimates, riskFlags, roofOrders } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { canonicalJson } from '../../http/idempotency';
import { problem } from '../../http/problem';
import { effectivePoint, loadProperty } from '../properties/service';
import { isoDate, type ItemRow, selectPriceBook } from '../pricebooks/service';

export const GATING_RULES_VERSION = 'gating@1.0.0';
export const LINE_RECIPE = 'shared.line-specs@1.0.0';

export type EstimateRow = typeof estimates.$inferSelect;
export type EstimateRevisionRow = typeof estimateRevisions.$inferSelect;

/** Pricing unit -> canonical measurement unit + the geometry/pricing unit name for conversion. */
const UNIT_MAP: Record<string, { canonical: string; unit: QuantityUnit | null }> = {
  linear_ft: { canonical: 'm', unit: 'ft' },
  linear_m: { canonical: 'm', unit: 'm' },
  sq_ft: { canonical: 'm2', unit: 'ft2' },
  sq_m: { canonical: 'm2', unit: 'm2' },
  sq_yd: { canonical: 'm2', unit: 'yd2' },
  roofing_square: { canonical: 'm2', unit: 'square' },
  cu_ft: { canonical: 'm3', unit: 'ft3' },
  cu_yd: { canonical: 'm3', unit: 'yd3' },
  cu_m: { canonical: 'm3', unit: 'm3' },
  each: { canonical: 'count', unit: null },
};
const CANONICAL_TO_UNIT: Record<string, QuantityUnit> = { m: 'm', m2: 'm2', m3: 'm3' };

const CATEGORY: Record<string, CostCategory> = {
  labor: 'labor',
  material: 'material',
  disposal: 'disposal',
  equipment: 'equipment',
  subcontract: 'subcontract',
  permit: 'permit',
  traffic_control: 'traffic_control',
  mobilization: 'fixed',
  allowance: 'allowance',
  fee: 'fixed',
};

function convert(value: number, canonical: string, pricingUnit: string): string | null {
  const map = UNIT_MAP[pricingUnit];
  if (!map || map.canonical !== canonical) return null;
  if (map.unit === null) return String(value);
  const from = CANONICAL_TO_UNIT[canonical];
  if (!from) return null;
  return convertQuantity(String(value), from, map.unit).toDecimalPlaces(6).toString();
}

interface LineBuild {
  line: CostLineInput;
  quantitySource: string[];
}

/**
 * Builds engine lines. Unknown measurements stay unknown (quantity null -> pending review, never
 * $0). A measurement that is not field-verified or survey-supplied is BOUNDED by its precision, so
 * the estimate is a range, never firm (CP-058; curb photos only suggest).
 */
export function buildLines(specs: EstimateLineSpec[], inputs: Record<string, Measurement>, items: ItemRow[], revisionId: string): LineBuild[] {
  return specs.map((spec) => {
    const item = items.find((i) => i.code === spec.code);
    const base = {
      code: spec.code,
      critical: spec.critical,
      sourceRevision: revisionId,
      formulaVersion: LINE_RECIPE,
    };
    if (!item) {
      return {
        quantitySource: spec.quantityKey ? [spec.quantityKey] : [],
        line: { ...base, description: spec.code, category: 'allowance', quantity: null, unit: 'each', unitRate: null, confidence: 'low', formula: 'no price-book item', unresolvedReason: `${spec.code} is not in the selected price book` },
      };
    }
    const unitRate = item.unitRate !== null ? item.unitRate : item.fixedAmountMinor !== null ? (item.fixedAmountMinor / 100).toFixed(2) : null;
    const common = {
      ...base,
      description: item.label,
      category: CATEGORY[item.category] ?? 'allowance',
      unit: item.unit,
      unitRate,
      taxable: item.taxable,
    };
    let quantity: CostLineInput['quantity'] = null;
    let reason: string | undefined;
    let confidence: CostLineInput['confidence'] = 'high';
    let formula = '';
    if (spec.quantity !== undefined) {
      quantity = spec.quantity;
      formula = `${spec.quantity} ${item.unit} (entered) x ${unitRate ?? '?'}`;
    } else {
      const m = inputs[spec.quantityKey!];
      if (!m || m.state === 'unknown') {
        reason = `${spec.quantityKey} is unknown${m && m.state === 'unknown' ? ` (${m.reason})` : ''}`;
        confidence = 'low';
      } else {
        const v = convert(m.value, m.unit, item.unit);
        if (v === null) {
          reason = `${spec.quantityKey} is in ${m.unit}; ${item.code} is priced per ${item.unit}`;
          confidence = 'low';
        } else if (isTrusted(m)) {
          quantity = v;
          formula = `${spec.quantityKey} ${m.value} ${m.unit} = ${v} ${item.unit} (${m.source}) x ${unitRate ?? '?'}`;
        } else {
          const low = convert(Math.max(0, m.value - m.precision), m.unit, item.unit)!;
          const high = convert(m.value + m.precision, m.unit, item.unit)!;
          const bounded: Bounded = { low, base: v, high, reason: `${spec.quantityKey} is ${m.source} (±${m.precision} ${m.unit}); not field-verified` };
          quantity = bounded;
          confidence = 'medium';
          formula = `${spec.quantityKey} ${m.value}±${m.precision} ${m.unit} (${m.source}) x ${unitRate ?? '?'}`;
        }
      }
    }
    if (item.minimumQuantity !== null && typeof quantity === 'string' && Number(quantity) < Number(item.minimumQuantity)) {
      formula += ` (minimum ${item.minimumQuantity} applied)`;
      quantity = item.minimumQuantity;
    }
    return {
      quantitySource: spec.quantityKey ? [spec.quantityKey] : ['entered'],
      line: { ...common, quantity, confidence, formula, ...(reason && { unresolvedReason: reason }) },
    };
  });
}

// ------------------------------------------------------------------ gating (CP-059, non-negotiables)
export interface GatingFacts {
  productLine: ProductLine;
  siteConditions: Record<string, SiteCondition>;
  openRiskFlags: { id: string; kind: string; message: string }[];
  jurisdictionStatus: string | null;
  scopeConfirmed: boolean | null;
  stale: { since: string; reason: string } | null;
}

/** Blocker codes that need a human pricing/scope review rather than a field check. */
const REVIEW_BLOCKERS = new Set(['price_unresolved', 'price_stale', 'price_conflict', 'structure_scope_unconfirmed', 'estimate_stale']);

/** A condition "known" only from photos or a model is treated as unknown (never inferred). */
function trustedCondition(c: SiteCondition | undefined): boolean | null {
  if (!c || c.state === 'unknown') return null;
  if (c.source === 'machine_estimated' || c.source === 'imagery_derived') return null;
  return c.value;
}

export function evaluateGating(
  facts: GatingFacts,
  result: EstimateResult,
  selection: PriceSelection,
  requiredSignoffs: SignoffRole[],
): GatingResult & { status: EstimateStatus } {
  const blockers: GatingResult['blockers'] = [];
  const warnings: GatingResult['warnings'] = [];
  if (facts.productLine === 'curb') {
    const sc = facts.siteConditions;
    const permit = trustedCondition(sc.permit_required);
    if (permit === null) blockers.push({ code: 'permit_status_unknown', message: 'Permit requirement is not confirmed.', resolution: 'Answer the permit questions with the jurisdiction.' });
    else if (permit) blockers.push({ code: 'permit_required', message: 'A permit is required: only a budgetary range can be offered until it is issued.', resolution: 'Permit reviewer sign-off after issuance.' });
    const row = trustedCondition(sc.public_right_of_way);
    if (row === null) blockers.push({ code: 'right_of_way_unknown', message: 'Whether the work is in the public right-of-way is not confirmed.', resolution: 'Field verification.' });
    else if (row) blockers.push({ code: 'public_right_of_way', message: 'Work in the public right-of-way needs municipal authorization.', resolution: 'Municipal approval on file.' });
    const util = trustedCondition(sc.utilities_cleared);
    if (util === null) blockers.push({ code: 'utilities_unknown', message: 'Utility clearance is unknown.', resolution: 'Utility locate ticket and field check.' });
    else if (!util) blockers.push({ code: 'utilities_not_cleared', message: 'Utilities are not cleared.', resolution: 'Utility locate ticket and field check.' });
    const depth = trustedCondition(sc.depth_verified);
    if (depth !== true) blockers.push({ code: 'depth_uncertain', message: 'Slab/curb depth is not field-verified (photos cannot prove buried thickness).', resolution: 'Field measurement or core.' });
    for (const f of facts.openRiskFlags) blockers.push({ code: 'risk_flag_open', message: f.message, resolution: 'Resolve the risk flag.', riskFlagId: f.id });
    if (facts.jurisdictionStatus === 'ambiguous') blockers.push({ code: 'jurisdiction_ambiguous', message: 'Overlapping jurisdictions claim this location.', resolution: 'Pick the locality manually and verify with the municipality.' });
    if (facts.jurisdictionStatus === 'unresolved' || facts.jurisdictionStatus === null) blockers.push({ code: 'jurisdiction_unresolved', message: 'No jurisdiction boundary matched this location.', resolution: 'Select the locality manually.' });
  } else {
    if (facts.scopeConfirmed === false) blockers.push({ code: 'structure_scope_unconfirmed', message: 'Confirm which structures are in scope.', resolution: 'Property scope confirmation.' });
    if (facts.jurisdictionStatus === 'ambiguous' || facts.jurisdictionStatus === 'unresolved') {
      warnings.push({ code: `jurisdiction_${facts.jurisdictionStatus}`, message: 'Jurisdiction is not resolved; check permit rules manually.' });
    }
  }
  for (const l of result.lines) {
    if (l.status !== 'unresolved') continue;
    const entry = { code: l.critical ? 'price_unresolved' : 'line_unresolved', message: `${l.code}: ${l.unresolvedReason ?? 'missing quantity or price'}`, resolution: 'Provide the measurement or an approved price.' };
    (l.critical ? blockers : warnings).push(entry);
  }
  for (const s of selection.stale) blockers.push({ code: 'price_stale', message: `${s.code}: price is older than ${s.maxAgeDays} days or the revision expired.`, resolution: 'Human price check and a new price-book revision.' });
  for (const c of selection.conflicts) blockers.push({ code: 'price_conflict', message: `${c.code}: matching regional books disagree.`, resolution: 'Human price check: reconcile the regional books.' });
  if (selection.fallback) warnings.push({ code: 'price_fallback_disclosed', message: selection.disclosure ?? 'A broader price book was used.' });
  if (result.status === 'priced' && !result.firm) {
    blockers.push({ code: 'quantities_unverified', message: `Range only: ${result.rangeDrivers.map((d) => d.reason).join('; ') || 'bounded inputs'}.`, resolution: 'Field-verify the measurements.' });
  }
  for (const f of result.flags) warnings.push({ code: `engine_${f.code}`, message: f.message });
  if (facts.stale) blockers.push({ code: 'estimate_stale', message: `Inputs changed (${facts.stale.reason}); reprice before approval.`, resolution: 'Reprice.' });

  const needsReview = blockers.some((b) => REVIEW_BLOCKERS.has(b.code)) || result.status === 'pending_review';
  const quoteKind: GatingResult['quoteKind'] = needsReview ? 'review_required' : blockers.length ? 'budgetary_range' : 'firm';
  const status: EstimateStatus = blockers.length === 0 ? 'pricing_ready' : needsReview ? 'review_required' : 'field_check_required';
  return { quoteKind, blockers, warnings, requiredSignoffs, status };
}

/** Moves an estimate along the CV-050 machine; approved estimates fall back to review_required. */
export function nextStatus(current: EstimateStatus, computed: EstimateStatus): EstimateStatus {
  if (current === computed) return current;
  if (current === 'rejected') throw problem('invalid_transition', 'A rejected estimate must be reopened first.');
  if (estimateMachine.canTransition(current, computed)) return computed;
  if (estimateMachine.canTransition(current, 'review_required')) return 'review_required';
  return computed;
}

// ------------------------------------------------------------------ facts loading
export async function loadGatingFacts(
  tx: Tx,
  orgId: string,
  e: { productLine: ProductLine; curbProjectId: string | null; propertyId: string | null; staleSince: Date | null; staleReason: string | null },
  siteConditions: Record<string, SiteCondition>,
): Promise<GatingFacts> {
  const openRiskFlags = e.curbProjectId
    ? await tx
        .select({ id: riskFlags.id, kind: riskFlags.kind, message: riskFlags.message })
        .from(riskFlags)
        .where(and(eq(riskFlags.orgId, orgId), eq(riskFlags.curbProjectId, e.curbProjectId), eq(riskFlags.status, 'open')))
        .orderBy(asc(riskFlags.id))
    : [];
  const p = e.propertyId ? await loadProperty(tx, orgId, e.propertyId) : null;
  const sc: Record<string, SiteCondition> = { ...siteConditions };
  if (e.productLine === 'curb') for (const k of CURB_SITE_CONDITION_KEYS) sc[k] ??= { state: 'unknown', reason: 'not_provided' };
  return {
    productLine: e.productLine,
    siteConditions: sc,
    openRiskFlags,
    jurisdictionStatus: p?.jurisdictionStatus ?? null,
    scopeConfirmed: p ? p.scopeConfirmedAt !== null : null,
    stale: e.staleSince ? { since: e.staleSince.toISOString(), reason: e.staleReason ?? 'inputs_changed' } : null,
  };
}

// ------------------------------------------------------------------ revision computation
export interface RevisionInputs {
  inputs: Record<string, Measurement>;
  lineSpecs: EstimateLineSpec[];
  siteConditions: Record<string, SiteCondition>;
  assumptions: string[];
  priceBookRevisionId: string | null;
}

export interface ComputedRevision {
  values: Omit<typeof estimateRevisions.$inferInsert, 'orgId' | 'estimateId' | 'revisionNumber' | 'createdByUserId'>;
  status: EstimateStatus;
  inputHash: string;
}

const minor = (m: { minor: bigint }) => Number(m.minor);

export async function computeRevision(
  tx: Tx,
  orgId: string,
  subject: { productLine: ProductLine; curbProjectId: string | null; propertyId: string | null },
  input: RevisionInputs,
  signoffsFor: (q: { amountMinor: number | null; jurisdictionId: string | null }) => Promise<SignoffRole[]>,
  today = isoDate(new Date()),
): Promise<ComputedRevision> {
  const property = subject.propertyId ? await loadProperty(tx, orgId, subject.propertyId) : null;
  const pt = property ? effectivePoint(property) : null;
  const selected = await selectPriceBook(tx, {
    orgId,
    productLine: subject.productLine,
    point: pt ? { lon: pt.coordinates[0], lat: pt.coordinates[1] } : null,
    revisionId: input.priceBookRevisionId,
    today,
  });
  const rev = selected.revision;
  const built = buildLines(input.lineSpecs, input.inputs, selected.items, rev.id);
  const currency = selected.book.currency as Currency;
  const result = priceEstimate({
    trade: subject.productLine,
    lines: built.map((b) => b.line),
    policy: {
      currency,
      overheadRate: rev.overheadRate ?? '0',
      contingencyRate: rev.contingencyRate ?? '0',
      price: rev.marginStrategy === 'markup' ? { method: 'markup', markupRate: rev.marginRate ?? '0' } : { method: 'target_margin', marginRate: rev.marginRate ?? '0' },
      tax: { rate: rev.taxRate ?? '0' },
      minimumCharge: rev.minimumChargeMinor === null ? null : (rev.minimumChargeMinor / 100).toFixed(2),
      revision: rev.id,
    },
    recipe: LINE_RECIPE,
  });
  const facts = await loadGatingFacts(tx, orgId, { ...subject, staleSince: null, staleReason: null }, input.siteConditions);
  const requiredSignoffs = await signoffsFor({
    amountMinor: result.scenarios ? Number(result.scenarios.base.total.minor) : null,
    jurisdictionId: property?.jurisdictionId ?? null,
  });
  const gating = evaluateGating(facts, result, selected.selection, requiredSignoffs);

  const scenarioDto = result.scenarios
    ? Object.fromEntries(
        (['low', 'base', 'high'] as const).map((s) => {
          const b = result.scenarios![s];
          return [
            s,
            {
              directMinor: minor(b.directCost),
              overheadMinor: minor(b.overhead),
              contingencyMinor: minor(b.contingency),
              marginMinor: Number(b.subtotal.minor - b.costBasis.minor),
              subtotalMinor: minor(b.subtotal),
              taxMinor: minor(b.tax),
              totalMinor: minor(b.total),
              lines: result.lines
                .filter((l) => l.status === 'priced')
                .map((l) => ({
                  code: l.code,
                  label: l.description,
                  costComponent: selected.items.find((i) => i.code === l.code)?.costComponent ?? 'other_allowance',
                  quantity: l.quantity![s],
                  unit: l.unit,
                  unitRate: l.unitRate?.[s] ?? null,
                  amountMinor: minor(l.extended![s]),
                  quantitySource: built.find((b) => b.line.code === l.code)?.quantitySource ?? [],
                })),
            },
          ];
        }),
      )
    : null;
  const snapshot = {
    priceBook: { id: selected.book.id, name: selected.book.name, currency: selected.book.currency, serviceAreaId: selected.book.serviceAreaId },
    revision: {
      id: rev.id,
      revisionNumber: rev.revisionNumber,
      effectiveFrom: rev.effectiveFrom,
      effectiveTo: rev.effectiveTo,
      overheadRate: rev.overheadRate,
      contingencyRate: rev.contingencyRate,
      marginStrategy: rev.marginStrategy,
      marginRate: rev.marginRate,
      taxRate: rev.taxRate,
      maxPriceAgeDays: rev.maxPriceAgeDays,
      approvedAt: rev.approvedAt?.toISOString() ?? null,
    },
    items: selected.items.map((i) => ({ code: i.code, label: i.label, category: i.category, costComponent: i.costComponent, unit: i.unit, unitRate: i.unitRate, fixedAmountMinor: i.fixedAmountMinor, minimumQuantity: i.minimumQuantity, taxable: i.taxable, source: i.source, sourceRef: i.sourceRef, priceDate: i.priceDate })),
    selection: selected.selection,
  };
  const engineVersions = { pricing: ENGINE_VERSION, recipe: LINE_RECIPE, gating: GATING_RULES_VERSION };
  const inputHash = createHash('sha256')
    .update(
      canonicalJson({
        inputs: input.inputs,
        lineSpecs: input.lineSpecs,
        siteConditions: input.siteConditions,
        assumptions: input.assumptions,
        snapshot,
        facts: { ...facts, stale: null },
        engineVersions,
        requiredSignoffs,
      }),
    )
    .digest('hex');
  const { status, ...gatingResult } = gating;
  const base = scenarioDto?.base as { subtotalMinor: number; taxMinor: number; totalMinor: number } | undefined;
  return {
    status,
    inputHash,
    values: {
      status,
      priceBookRevisionId: rev.id,
      inputs: input.inputs,
      scenarios: scenarioDto ?? {},
      lines: result.lines.map((l) => ({ ...l, extended: l.extended ? Object.fromEntries(Object.entries(l.extended).map(([k, v]) => [k, { amount: v.amount, minor: Number(v.minor) }])) : null })),
      currency,
      subtotalMinor: base?.subtotalMinor ?? null,
      taxMinor: base?.taxMinor ?? null,
      totalMinor: base?.totalMinor ?? null,
      lowTotalMinor: scenarioDto ? (scenarioDto.low as { totalMinor: number }).totalMinor : null,
      highTotalMinor: scenarioDto ? (scenarioDto.high as { totalMinor: number }).totalMinor : null,
      engineVersion: ENGINE_VERSION,
      engineVersions,
      inputHash,
      lineSpecs: input.lineSpecs,
      siteConditions: input.siteConditions,
      priceBookSnapshot: snapshot,
      gatingResult,
      quoteKind: gatingResult.quoteKind,
      // A revision is binding-eligible only as a firm quote with no blockers; it is OFFERED as
      // binding only once approved (estimates.approved_revision_id).
      isBinding: gatingResult.quoteKind === 'firm',
      assumptions: input.assumptions,
    },
  };
}

export async function latestRevision(tx: Tx, orgId: string, estimateId: string): Promise<EstimateRevisionRow | null> {
  const [r] = await tx
    .select()
    .from(estimateRevisions)
    .where(and(eq(estimateRevisions.orgId, orgId), eq(estimateRevisions.estimateId, estimateId)))
    .orderBy(desc(estimateRevisions.revisionNumber))
    .limit(1);
  return r ?? null;
}

export async function loadEstimate(tx: Tx, orgId: string, id: string, forUpdate = false): Promise<EstimateRow | null> {
  const q = tx.select().from(estimates).where(and(eq(estimates.orgId, orgId), eq(estimates.id, id)));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row ?? null;
}

export async function subjectProperty(tx: Tx, orgId: string, subject: { curbProjectId?: string | null; roofOrderId?: string | null }): Promise<string> {
  if (subject.curbProjectId) {
    const [c] = await tx.select({ propertyId: curbProjects.propertyId }).from(curbProjects).where(and(eq(curbProjects.orgId, orgId), eq(curbProjects.id, subject.curbProjectId)));
    if (!c) throw problem('not_found', 'Curb project not found.');
    return c.propertyId;
  }
  const [r] = await tx.select({ propertyId: roofOrders.propertyId }).from(roofOrders).where(and(eq(roofOrders.orgId, orgId), eq(roofOrders.id, subject.roofOrderId!)));
  if (!r) throw problem('not_found', 'Roof order not found.');
  return r.propertyId;
}

export async function nextEstimateNumber(tx: Tx, orgId: string): Promise<string> {
  const rows = await tx.execute<{ n: number }>(sql`select count(*)::int + 1 as n from estimates where org_id = ${orgId}`);
  const n = [...rows][0]!.n;
  return `EST-${String(n).padStart(5, '0')}`;
}

/**
 * Inserts a new revision (when its content differs) and moves the estimate. Returns whether a new
 * revision was written. Approved estimates whose priced content changed revert to review_required
 * (CP-059 S); the approved snapshot stays immutable.
 */
export async function applyRevision(
  tx: Tx,
  ctx: { orgId: string; userId: string },
  e: EstimateRow,
  computed: ComputedRevision,
): Promise<{ changed: boolean; estimate: EstimateRow; revision: EstimateRevisionRow }> {
  const latest = await latestRevision(tx, ctx.orgId, e.id);
  if (latest && latest.inputHash === computed.inputHash) {
    // Deterministic: identical inputs + price snapshot -> identical result; only clear staleness.
    if (!e.staleSince) return { changed: false, estimate: e, revision: latest };
    const [upd] = await tx
      .update(estimates)
      .set({ staleSince: null, staleReason: null, revision: e.revision + 1 })
      .where(eq(estimates.id, e.id))
      .returning();
    return { changed: true, estimate: upd!, revision: latest };
  }
  const [rev] = await tx
    .insert(estimateRevisions)
    .values({ ...computed.values, orgId: ctx.orgId, estimateId: e.id, revisionNumber: (latest?.revisionNumber ?? 0) + 1, createdByUserId: ctx.userId })
    .returning();
  const status = e.status === 'approved' ? 'review_required' : nextStatus(e.status, computed.status);
  const [upd] = await tx
    .update(estimates)
    .set({
      currentRevisionId: rev!.id,
      status,
      approvedRevisionId: e.status === 'approved' ? null : e.approvedRevisionId,
      staleSince: null,
      staleReason: null,
      revision: e.revision + 1,
    })
    .where(eq(estimates.id, e.id))
    .returning();
  return { changed: true, estimate: upd!, revision: rev! };
}
