// Estimate commands (COS starter C example EstimateLineItemQuantityChanged, ADD-017, ADD-060). Each
// recomputes a full revision from the latest revision's inputs with one change applied; identical
// content is an accepted no-op (deterministic repricing).
import type { EstimateLineSpec, Measurement, SiteCondition } from '@fieldline/contracts';
import { problem } from '../../http/problem';
import { commandHandler, type CommandContext, registerCommand } from '../commands/registry';
import { resolvePolicy } from '../approvals/policy';
import { applyRevision, computeRevision, type EstimateRevisionRow, type EstimateRow, latestRevision, loadEstimate, type RevisionInputs } from './service';

interface EstimateState {
  estimate: EstimateRow;
  latest: EstimateRevisionRow;
}

async function load(ctx: CommandContext, id: string) {
  const estimate = await loadEstimate(ctx.tx, ctx.orgId, id, true);
  if (!estimate) return null;
  const latest = await latestRevision(ctx.tx, ctx.orgId, id);
  if (!latest) return null;
  return { revision: estimate.revision, state: { estimate, latest } };
}

function inputsOf(r: EstimateRevisionRow): RevisionInputs {
  return {
    inputs: r.inputs as Record<string, Measurement>,
    lineSpecs: r.lineSpecs as EstimateLineSpec[],
    siteConditions: r.siteConditions as Record<string, SiteCondition>,
    assumptions: r.assumptions as string[],
    priceBookRevisionId: null,
  };
}

function notRejected(s: EstimateState) {
  if (s.estimate.status === 'rejected') throw problem('invalid_transition', 'The estimate was rejected; reopen it first.');
}

async function reprice(ctx: CommandContext, s: EstimateState, next: RevisionInputs, action: string) {
  const e = s.estimate;
  const computed = await computeRevision(
    ctx.tx,
    ctx.orgId,
    { productLine: e.productLine, curbProjectId: e.curbProjectId, propertyId: e.propertyId },
    next,
    async (q) => (await resolvePolicy(ctx.tx, ctx.orgId, { subjectType: 'estimate_revision', productLine: e.productLine, ...q })).requiredSignoffs,
  );
  const applied = await applyRevision(ctx.tx, { orgId: ctx.orgId, userId: ctx.userId }, e, computed);
  return {
    serverRevision: applied.estimate.revision,
    changed: applied.changed,
    audit: {
      action,
      before: { status: e.status, revisionId: s.latest.id, totalMinor: s.latest.totalMinor, inputHash: s.latest.inputHash, approvedRevisionId: e.approvedRevisionId },
      after: { status: applied.estimate.status, revisionId: applied.revision.id, totalMinor: applied.revision.totalMinor, inputHash: applied.revision.inputHash, approvedRevisionId: applied.estimate.approvedRevisionId },
    },
    event: { type: 'estimate.revised', payload: { estimateId: e.id, revisionId: applied.revision.id, status: applied.estimate.status } },
  };
}

export function registerEstimateCommands(): void {
  if (commandHandler('EstimateRepriced')) return;

  registerCommand<'EstimateLineItemQuantityChanged', EstimateState>({
    type: 'EstimateLineItemQuantityChanged',
    aggregateType: 'estimate',
    permission: 'estimate:write',
    load,
    validate(_ctx, s, p) {
      notRejected(s);
      const specs = s.latest.lineSpecs as EstimateLineSpec[];
      if (!specs.some((l) => l.code === p.item_id)) throw problem('not_found', `No line ${p.item_id} on this estimate.`);
      const snapshot = s.latest.priceBookSnapshot as { items: { code: string; unit: string }[] };
      const item = snapshot.items.find((i) => i.code === p.item_id);
      if (item && item.unit !== p.unit) {
        throw problem('validation_failed', `${p.item_id} is priced per ${item.unit}.`, { errors: [{ path: 'body.payload.unit', message: `expected ${item.unit}` }] });
      }
    },
    diff(s, p) {
      const spec = (s.latest.lineSpecs as EstimateLineSpec[]).find((l) => l.code === p.item_id);
      return [{ field: `lines.${p.item_id}.quantity`, server: spec?.quantity ?? (spec?.quantityKey ? { from: spec.quantityKey } : null), yours: p.quantity }];
    },
    async execute(ctx, { state }, p) {
      const next = inputsOf(state.latest);
      next.lineSpecs = next.lineSpecs.map((l) => (l.code === p.item_id ? { code: l.code, critical: l.critical, quantity: p.quantity } : l));
      return reprice(ctx, state, next, 'estimate.line_quantity_changed');
    },
  });

  registerCommand<'EstimateInputChanged', EstimateState>({
    type: 'EstimateInputChanged',
    aggregateType: 'estimate',
    permission: 'estimate:write',
    load,
    validate: (_c, s) => notRejected(s),
    diff: (s, p) => [{ field: `inputs.${p.key}`, server: (s.latest.inputs as Record<string, unknown>)[p.key] ?? null, yours: p.value }],
    async execute(ctx, { state }, p) {
      const next = inputsOf(state.latest);
      next.inputs = { ...next.inputs, [p.key]: p.value };
      return reprice(ctx, state, next, 'estimate.input_changed');
    },
  });

  registerCommand<'EstimateSiteConditionChanged', EstimateState>({
    type: 'EstimateSiteConditionChanged',
    aggregateType: 'estimate',
    permission: 'estimate:write',
    load,
    validate: (_c, s) => notRejected(s),
    diff: (s, p) => [{ field: `siteConditions.${p.key}`, server: (s.latest.siteConditions as Record<string, unknown>)[p.key] ?? null, yours: p.value }],
    async execute(ctx, { state }, p) {
      const next = inputsOf(state.latest);
      next.siteConditions = { ...next.siteConditions, [p.key]: p.value as SiteCondition };
      return reprice(ctx, state, next, 'estimate.site_condition_changed');
    },
  });

  registerCommand<'EstimateRepriced', EstimateState>({
    type: 'EstimateRepriced',
    aggregateType: 'estimate',
    permission: 'estimate:write',
    load,
    validate: (_c, s) => notRejected(s),
    diff: (s) => [{ field: 'currentRevisionId', server: s.estimate.currentRevisionId, yours: 'reprice' }],
    async execute(ctx, { state }, p) {
      const next = inputsOf(state.latest);
      if (p.price_book_revision_id) next.priceBookRevisionId = p.price_book_revision_id;
      return reprice(ctx, state, next, 'estimate.repriced');
    },
  });
}
