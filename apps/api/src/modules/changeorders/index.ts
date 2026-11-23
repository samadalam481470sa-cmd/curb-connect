// `changeorders` module (Phase E, item 25): change orders against approved scope, with an
// internal typed-name signature attestation. Tables: change_orders (schema/changeorders.ts),
// signature_envelopes + signature_events (schema/signatures.ts). No e-sign provider is
// connected: signing records a 'signed' event with the document hash and the signer's typed
// name; it never claims a third-party signature service was used.
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { changeOrders, jobs, signatureEnvelopes, signatureEvents } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { canTransitionChangeOrder, changeOrderDocumentHash, typedSignatureMatches } from './attestation';

const UUID = z.uuid();
const JobParams = z.object({ jobId: UUID });
const IdParams = z.object({ id: UUID });
const LineInput = z.object({
  label: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(40),
  unitPriceMinor: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
});

const coDto = (r: typeof changeOrders.$inferSelect) => ({
  ...r,
  createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  sentAt: r.sentAt?.toISOString() ?? null, decidedAt: r.decidedAt?.toISOString() ?? null,
});

const changeordersModule: FastifyPluginAsyncZod = async (app) => {
  app.get('/jobs/:jobId/change-orders', {
    config: { permission: 'change_order:read' },
    schema: { tags: ['change-orders'], params: JobParams, summary: 'Change orders for a job' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const rows = await tenantTx(request, async (tx) => {
      const [job] = await tx.select().from(jobs)
        .where(and(eq(jobs.orgId, orgId), eq(jobs.id, request.params.jobId)));
      if (!job) throw problem('not_found');
      return tx.select().from(changeOrders)
        .where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.jobId, request.params.jobId)))
        .orderBy(desc(changeOrders.createdAt)).limit(200);
    });
    return { items: rows.map(coDto) };
  });

  app.post('/jobs/:jobId/change-orders', {
    config: { permission: 'change_order:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['change-orders'], params: JobParams,
      body: z.object({
        number: z.string().trim().min(1).max(50),
        title: z.string().trim().min(2).max(300),
        reason: z.string().trim().min(3).max(5000),
        lines: z.array(LineInput).max(200).default([]),
        amountDeltaMinor: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
        scheduleImpactDays: z.number().int().min(0).max(3650).default(0),
      }),
    },
  }, async (request, reply) => {
    const { orgId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      const [job] = await tx.select().from(jobs)
        .where(and(eq(jobs.orgId, orgId), eq(jobs.id, request.params.jobId)));
      if (!job) throw problem('not_found');
      const [created] = await tx.insert(changeOrders).values({
        orgId, jobId: request.params.jobId, number: request.body.number,
        title: request.body.title, reason: request.body.reason, lines: request.body.lines,
        amountDeltaMinor: request.body.amountDeltaMinor,
        scheduleImpactDays: request.body.scheduleImpactDays, status: 'draft',
      }).returning();
      if (!created) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'change_order.created', resourceType: 'change_order', resourceId: created.id, after: { number: created.number, amountDeltaMinor: created.amountDeltaMinor } });
      return created;
    });
    return reply.code(201).send(coDto(row));
  });

  app.patch('/change-orders/:id/status', {
    config: { permission: 'change_order:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['change-orders'], params: IdParams,
      body: z.object({
        status: z.enum(['draft', 'pending_internal_approval', 'sent_to_customer', 'accepted', 'rejected', 'withdrawn']),
        signerName: z.string().trim().min(2).max(200).optional(),
      }),
    },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const revision = parseIfMatch(request);
    const row = await tenantTx(request, async (tx) => {
      const [current] = await tx.select().from(changeOrders)
        .where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.id, request.params.id))).for('update');
      if (!current) throw problem('not_found');
      assertRevision(current.revision, revision);
      if (!canTransitionChangeOrder(current.status, request.body.status)) {
        throw problem('conflict', 'That change order status change is not allowed.');
      }
      let envelopeId = current.envelopeId;
      if (request.body.status === 'sent_to_customer') {
        if (!request.body.signerName?.trim()) {
          throw problem('validation_failed', 'Name the customer signer before sending for signature.');
        }
        const hash = changeOrderDocumentHash({
          number: current.number, title: current.title, reason: current.reason,
          amountDeltaMinor: current.amountDeltaMinor, currency: current.currency,
          scheduleImpactDays: current.scheduleImpactDays, lines: current.lines,
        });
        const [envelope] = await tx.insert(signatureEnvelopes).values({
          orgId, subjectType: 'change_order', subjectId: current.id, provider: 'internal',
          status: 'sent', documentSha256: hash,
          signers: [{ name: request.body.signerName, role: 'customer', order: 1, signedAt: null }],
        }).returning();
        if (!envelope) throw problem('internal');
        envelopeId = envelope.id;
        await tx.insert(signatureEvents).values({
          orgId, envelopeId: envelope.id, eventType: 'sent', documentSha256: hash,
          data: { signerName: request.body.signerName },
        });
      }
      const [updated] = await tx.update(changeOrders).set({
        status: request.body.status, envelopeId,
        sentAt: request.body.status === 'sent_to_customer' ? new Date() : current.sentAt,
        decidedAt: ['accepted', 'rejected', 'withdrawn'].includes(request.body.status) ? new Date() : current.decidedAt,
        revision: current.revision + 1, updatedAt: new Date(),
      }).where(eq(changeOrders.id, current.id)).returning();
      if (!updated) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'change_order.status', resourceType: 'change_order', resourceId: current.id, before: { status: current.status }, after: { status: updated.status } });
      return updated;
    });
    return coDto(row);
  });

  app.post('/change-orders/:id/sign', {
    config: { permission: 'change_order:approve', rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['change-orders'], params: IdParams,
      body: z.object({
        signerName: z.string().trim().min(2).max(200),
        typedSignature: z.string().trim().min(2).max(200),
        consent: z.literal(true),
      }),
    },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const revision = parseIfMatch(request);
    const row = await tenantTx(request, async (tx) => {
      const [current] = await tx.select().from(changeOrders)
        .where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.id, request.params.id))).for('update');
      if (!current) throw problem('not_found');
      assertRevision(current.revision, revision);
      if (current.status !== 'sent_to_customer' || !current.envelopeId) {
        throw problem('conflict', 'This change order is not out for signature.');
      }
      if (!typedSignatureMatches(request.body.signerName, request.body.typedSignature)) {
        throw problem('validation_failed', 'The typed signature must match the signer name exactly.');
      }
      const [envelope] = await tx.select().from(signatureEnvelopes)
        .where(and(eq(signatureEnvelopes.orgId, orgId), eq(signatureEnvelopes.id, current.envelopeId))).for('update');
      if (!envelope || envelope.status !== 'sent') throw problem('conflict', 'The signature envelope is not open.');
      const signers = (envelope.signers as { name: string; role: string; order: number; signedAt: string | null }[]) ?? [];
      const signer = signers.find((s) => s.name.trim().toLowerCase() === request.body.signerName.trim().toLowerCase());
      if (!signer) throw problem('validation_failed', 'That signer is not named on this change order.');
      if (signer.signedAt) throw problem('conflict', 'This signer has already signed.');
      const signedAt = new Date();
      const hash = changeOrderDocumentHash({
        number: current.number, title: current.title, reason: current.reason,
        amountDeltaMinor: current.amountDeltaMinor, currency: current.currency,
        scheduleImpactDays: current.scheduleImpactDays, lines: current.lines,
      });
      await tx.insert(signatureEvents).values({
        orgId, envelopeId: envelope.id, eventType: 'signed', signerRef: signer.name,
        documentSha256: hash, data: { method: 'typed_name_attestation', consent: true },
      });
      const updatedSigners = signers.map((s) => (s === signer ? { ...s, signedAt: signedAt.toISOString() } : s));
      await tx.update(signatureEnvelopes).set({
        signers: updatedSigners, status: 'completed', completedAt: signedAt,
        revision: envelope.revision + 1, updatedAt: signedAt,
      }).where(eq(signatureEnvelopes.id, envelope.id));
      await tx.insert(signatureEvents).values({
        orgId, envelopeId: envelope.id, eventType: 'completed', documentSha256: hash,
      });
      const [updated] = await tx.update(changeOrders).set({
        status: 'accepted', decidedAt: signedAt,
        revision: current.revision + 1, updatedAt: signedAt,
      }).where(eq(changeOrders.id, current.id)).returning();
      if (!updated) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'change_order.signed', resourceType: 'change_order', resourceId: current.id, after: { signer: signer.name, method: 'typed_name_attestation' } });
      return updated;
    });
    return coDto(row);
  });

  app.get('/change-orders/:id/signature-events', {
    config: { permission: 'change_order:read' },
    schema: { tags: ['change-orders'], params: IdParams, summary: 'Signature event log for a change order' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const result = await tenantTx(request, async (tx) => {
      const [current] = await tx.select().from(changeOrders)
        .where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.id, request.params.id)));
      if (!current) throw problem('not_found');
      if (!current.envelopeId) return { envelope: null, events: [] };
      const [envelope] = await tx.select().from(signatureEnvelopes)
        .where(and(eq(signatureEnvelopes.orgId, orgId), eq(signatureEnvelopes.id, current.envelopeId)));
      const events = await tx.select().from(signatureEvents)
        .where(and(eq(signatureEvents.orgId, orgId), eq(signatureEvents.envelopeId, current.envelopeId)))
        .orderBy(signatureEvents.occurredAt);
      return {
        envelope: envelope ? { ...envelope, createdAt: envelope.createdAt.toISOString(), updatedAt: envelope.updatedAt.toISOString(), expiresAt: envelope.expiresAt?.toISOString() ?? null, completedAt: envelope.completedAt?.toISOString() ?? null } : null,
        events: events.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString(), createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString() })),
      };
    });
    return result;
  });
};

export default changeordersModule;
