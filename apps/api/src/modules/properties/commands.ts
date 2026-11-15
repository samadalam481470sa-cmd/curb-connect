// Property commands registered into the shared command registry (COS starter C, RF-017 B,
// RF-077 B/S). Each one bumps the property revision and marks dependent estimates stale.
import { and, eq } from 'drizzle-orm';
import { properties, structures } from '../../db/schema';
import { problem } from '../../http/problem';
import { commandHandler, registerCommand } from '../commands/registry';
import {
  loadJurisdictionCandidate,
  loadProperty,
  loadStructures,
  type LoadedProperty,
  markDependentEstimatesStale,
  pointWkt,
  resolveJurisdiction,
  withoutReason,
  withReason,
} from './service';

function jurisdictionReasons(reason: string | null, status: string): string | null {
  let r = withoutReason(withoutReason(withoutReason(reason, 'jurisdiction_ambiguous'), 'jurisdiction_unresolved'), 'jurisdiction_resolved');
  if (status === 'ambiguous' || status === 'unresolved') r = withReason(r, `jurisdiction_${status}`);
  return r;
}

const load = async (ctx: { tx: Parameters<typeof loadProperty>[0]; orgId: string }, id: string) => {
  const p = await loadProperty(ctx.tx, ctx.orgId, id, true);
  return p ? { revision: p.revision, state: p } : null;
};

export function registerPropertyCommands(): void {
  if (commandHandler('PropertyPinRelocated')) return;

  registerCommand<'PropertyPinRelocated', LoadedProperty>({
    type: 'PropertyPinRelocated',
    aggregateType: 'property',
    permission: 'property:write',
    load,
    diff: (p, payload) => [{ field: 'confirmedLocation', server: p.confirmedJson, yours: payload.location }],
    async execute(ctx, { state: p }, payload) {
      // RF-017 B / RF-077 A: the geocoded point (location) and original query are never overwritten.
      const resolution = await resolveJurisdiction(ctx.tx, payload.location);
      let status: string = resolution.status;
      let jurisdictionId = resolution.jurisdictionId;
      // Keep a manual locality choice when it still covers the moved pin.
      if (p.jurisdictionStatus === 'manual' && p.jurisdictionId && resolution.candidates.some((c) => c.id === p.jurisdictionId)) {
        status = 'manual';
        jurisdictionId = p.jurisdictionId;
      }
      const reviewReason = jurisdictionReasons(withoutReason(withoutReason(p.reviewReason, 'pin_confirmation_required'), 'manual_pin_only'), status);
      await ctx.tx
        .update(properties)
        .set({
          confirmedLocation: pointWkt(payload.location),
          confirmedByUserId: ctx.userId,
          confirmedAt: ctx.now,
          jurisdictionStatus: status,
          jurisdictionId,
          jurisdictionCandidates: resolution.candidates,
          jurisdictionResolvedAt: ctx.now,
          reviewReason,
          needsReview: reviewReason !== null,
          revision: p.revision + 1,
        })
        .where(and(eq(properties.orgId, ctx.orgId), eq(properties.id, p.id)));
      const stale = await markDependentEstimatesStale(ctx.tx, ctx.orgId, p.id, 'property_pin_relocated');
      return {
        serverRevision: p.revision + 1,
        changed: true,
        audit: {
          action: 'property.pin_relocated',
          before: { confirmedLocation: p.confirmedJson, jurisdictionStatus: p.jurisdictionStatus, jurisdictionId: p.jurisdictionId },
          after: { confirmedLocation: payload.location, jurisdictionStatus: status, jurisdictionId, staleEstimates: stale },
          reason: payload.reason ?? null,
        },
        event: { type: 'property.pin_relocated', payload: { propertyId: p.id, staleEstimates: stale } },
      };
    },
  });

  registerCommand<'PropertyJurisdictionSelected', LoadedProperty>({
    type: 'PropertyJurisdictionSelected',
    aggregateType: 'property',
    permission: 'property:write',
    load,
    async validate(ctx, p, payload) {
      const j = await loadJurisdictionCandidate(ctx.tx, payload.jurisdiction_id);
      if (!j) throw problem('not_found', 'Unknown jurisdiction.');
      const candidates = (p.jurisdictionCandidates as { id: string }[]) ?? [];
      // With overlapping claims the choice must be one of the boundaries that cover the point.
      if (candidates.length > 0 && !candidates.some((c) => c.id === j.id)) {
        throw problem('validation_failed', 'Pick one of the jurisdictions whose boundary covers this property.', {
          errors: [{ path: 'body.payload.jurisdiction_id', message: 'not a candidate for this location' }],
        });
      }
    },
    diff: (p, payload) => [
      { field: 'jurisdictionId', server: p.jurisdictionId, yours: payload.jurisdiction_id },
      { field: 'jurisdictionStatus', server: p.jurisdictionStatus, yours: 'manual' },
    ],
    async execute(ctx, { state: p }, payload) {
      const reviewReason = jurisdictionReasons(p.reviewReason, 'manual');
      await ctx.tx
        .update(properties)
        .set({
          jurisdictionId: payload.jurisdiction_id,
          jurisdictionStatus: 'manual',
          jurisdictionSelectedByUserId: ctx.userId,
          jurisdictionResolvedAt: ctx.now,
          reviewReason,
          needsReview: reviewReason !== null,
          revision: p.revision + 1,
        })
        .where(and(eq(properties.orgId, ctx.orgId), eq(properties.id, p.id)));
      const stale = await markDependentEstimatesStale(ctx.tx, ctx.orgId, p.id, 'jurisdiction_selected');
      return {
        serverRevision: p.revision + 1,
        changed: true,
        audit: {
          action: 'property.jurisdiction_selected',
          before: { jurisdictionId: p.jurisdictionId, jurisdictionStatus: p.jurisdictionStatus },
          after: { jurisdictionId: payload.jurisdiction_id, jurisdictionStatus: 'manual', staleEstimates: stale },
          reason: payload.reason ?? null,
        },
        event: { type: 'property.jurisdiction_selected', payload: { propertyId: p.id, jurisdictionId: payload.jurisdiction_id } },
      };
    },
  });

  registerCommand<'PropertyStructureScopeConfirmed', LoadedProperty>({
    type: 'PropertyStructureScopeConfirmed',
    aggregateType: 'property',
    permission: 'property:write',
    load,
    async validate(ctx, p, payload) {
      const all = await loadStructures(ctx.tx, ctx.orgId, p.id);
      const listed = new Set(payload.structures.map((s) => s.structure_id));
      const unknown = payload.structures.filter((s) => !all.some((a) => a.id === s.structure_id));
      if (unknown.length) throw problem('not_found', 'A listed structure does not belong to this property.');
      // RF-017 S: never assume — every candidate needs an explicit in/out decision.
      const missing = all.filter((a) => !listed.has(a.id));
      if (missing.length) {
        throw problem('address_ambiguous', `Decide the scope of every structure (${missing.length} not listed).`, {
          errors: missing.map((m) => ({ path: `body.payload.structures.${m.id}`, message: `${m.label}: in or out of scope?` })),
        });
      }
    },
    diff: (p) => [{ field: 'scopeConfirmedAt', server: p.scopeConfirmedAt?.toISOString() ?? null, yours: 'confirm' }],
    async execute(ctx, { state: p }, payload) {
      const before = (await loadStructures(ctx.tx, ctx.orgId, p.id)).map((s) => ({ id: s.id, scopeStatus: s.scopeStatus, scopeConfirmed: s.scopeConfirmed }));
      for (const s of payload.structures) {
        await ctx.tx
          .update(structures)
          .set({ scopeStatus: s.scope_status, scopeConfirmed: true })
          .where(and(eq(structures.orgId, ctx.orgId), eq(structures.id, s.structure_id)));
      }
      const reviewReason = withoutReason(p.reviewReason, 'confirm_structures_in_scope');
      await ctx.tx
        .update(properties)
        .set({ scopeConfirmedAt: ctx.now, scopeConfirmedByUserId: ctx.userId, reviewReason, needsReview: reviewReason !== null, revision: p.revision + 1 })
        .where(and(eq(properties.orgId, ctx.orgId), eq(properties.id, p.id)));
      const stale = await markDependentEstimatesStale(ctx.tx, ctx.orgId, p.id, 'structure_scope_confirmed');
      return {
        serverRevision: p.revision + 1,
        changed: true,
        audit: { action: 'property.scope_confirmed', before, after: { structures: payload.structures, staleEstimates: stale } },
        event: { type: 'property.scope_confirmed', payload: { propertyId: p.id } },
      };
    },
  });
}

