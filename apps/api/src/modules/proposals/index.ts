// `proposals` module: estimate → proposal draft → send → accept → job. Versions are
// immutable once sent; editing a sent proposal starts a new draft version. Amounts are
// builder-entered per option; version totals are computed from the default package +
// default add-ons + entered tax. Sending emails the customer only when the mailer is
// connected — the version records the honest outcome ('not_connected' until then).
import { randomUUID } from 'node:crypto';
import {
  AcceptProposalRequestSchema,
  CreateProposalRequestSchema,
  ProposalEmailStatusSchema,
  ProposalListSchema,
  ProposalSchema,
  ProposalSelectionSchema,
  SendProposalRequestSchema,
  UpdateProposalVersionRequestSchema,
  type CreateProposalOptionInput,
} from '@fieldline/contracts';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  contacts,
  customers,
  estimateRevisions,
  estimates,
  jobCostBudgets,
  jobs,
  proposalOptions,
  proposalSelections,
  proposals,
  proposalVersions,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { EMAIL_NOT_CONNECTED_NOTE, emailConfigured } from '../../services/networkNotify';
import { assertProposalRevisionWritable, assertSalesProposalAccess, proposalAccessFilter } from '../enterprise/salesProposalAccess';
import { budgetLinesFromEstimateLines } from './budgetSeed';

const READ = 'proposal:read';
const WRITE = 'proposal:write';
const SEND = 'proposal:send';
const VOID = 'proposal:void';

const IdParams = z.object({ id: z.uuid() });
const VersionParams = z.object({ id: z.uuid(), versionId: z.uuid() });

type ProposalRow = typeof proposals.$inferSelect;
type VersionRow = typeof proposalVersions.$inferSelect;
type OptionRow = typeof proposalOptions.$inferSelect;

const money = (amountMinor: number, currency: string) => ({ amountMinor, currency });

function optionDto(row: OptionRow, currency: string) {
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    tier: row.tier,
    label: row.label,
    description: row.description,
    estimateRevisionId: row.estimateRevisionId,
    amount: money(row.amountMinor, currency),
    isDefault: row.isDefault,
  };
}

function versionDto(row: VersionRow, options: OptionRow[], currency: string) {
  return {
    id: row.id,
    proposalId: row.proposalId,
    versionNumber: row.versionNumber,
    status: row.status,
    content: (row.content as Record<string, unknown> | null) ?? {},
    options: options.map((o) => optionDto(o, currency)),
    subtotal: money(row.subtotalMinor, currency),
    tax: money(row.taxMinor, currency),
    total: money(row.totalMinor, currency),
    deposit: row.depositMinor === null ? null : money(row.depositMinor, currency),
    documentSha256: row.documentSha256,
    sentAt: row.sentAt?.toISOString() ?? null,
    emailState: row.emailState,
    emailNote: row.emailNote,
    emailSentAt: row.emailSentAt?.toISOString() ?? null,
  };
}

function proposalDto(
  row: ProposalRow,
  currentVersion: ReturnType<typeof versionDto> | null,
) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    number: row.number,
    jobId: row.jobId,
    customerId: row.customerId,
    contactId: row.contactId,
    title: row.title,
    status: row.status,
    currentVersion,
    acceptedVersionId: row.acceptedVersionId,
    expiresOn: row.expiresOn,
  };
}

/** Version subtotal = default package + default add-ons (first package when none is marked). */
function computeTotals(options: CreateProposalOptionInput[], taxMinor: number) {
  const packages = options.filter((o) => o.kind === 'package');
  const defaultPackage = packages.find((o) => o.isDefault) ?? packages[0];
  const addOns = options.filter((o) => o.kind === 'add_on' && o.isDefault);
  const subtotalMinor =
    (defaultPackage?.amountMinor ?? 0) + addOns.reduce((sum, o) => sum + o.amountMinor, 0);
  return { subtotalMinor, totalMinor: subtotalMinor + taxMinor };
}

async function loadProposalDetail(tx: Tx, orgId: string, id: string) {
  const [proposal] = await tx
    .select()
    .from(proposals)
    .where(and(eq(proposals.orgId, orgId), eq(proposals.id, id)))
    .limit(1);
  if (!proposal) throw problem('not_found');
  let current: VersionRow | null = null;
  let options: OptionRow[] = [];
  if (proposal.currentVersionId) {
    const [version] = await tx
      .select()
      .from(proposalVersions)
      .where(eq(proposalVersions.id, proposal.currentVersionId))
      .limit(1);
    current = version ?? null;
    if (current) {
      options = await tx
        .select()
        .from(proposalOptions)
        .where(eq(proposalOptions.proposalVersionId, current.id))
        .orderBy(proposalOptions.sortOrder);
    }
  }
  return proposalDto(proposal, current ? versionDto(current, options, proposal.currency) : null);
}

const proposalsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/proposals',
    {
      config: { permission: READ },
      schema: {
        tags: ['proposals'],
        summary: 'Proposals, newest first',
        querystring: z.object({
          status: z
            .enum([
              'draft',
              'pending_approval',
              'ready_to_send',
              'sent',
              'viewed',
              'accepted',
              'declined',
              'expired',
              'voided',
            ])
            .optional(),
        }),
        response: { 200: ProposalListSchema },
      },
    },
    async (request) => {
      const actor = requireOrg(request);
      const { orgId } = actor;
      const items = await tenantTx(request, async (tx) => {
        const list = await tx
          .select()
          .from(proposals)
          .where(
            and(
              eq(proposals.orgId, orgId),
              proposalAccessFilter(tx, actor, proposals.id),
              request.query.status ? eq(proposals.status, request.query.status) : undefined,
            ),
          )
          .orderBy(desc(proposals.createdAt))
          .limit(200);
        const versionIds = list.map((p) => p.currentVersionId).filter((v): v is string => Boolean(v));
        const versions = versionIds.length
          ? await tx
              .select()
              .from(proposalVersions)
              .where(and(eq(proposalVersions.orgId, orgId), inArray(proposalVersions.id, versionIds)))
          : [];
        const versionById = new Map(versions.map((v) => [v.id, v]));
        const optionRows = versionIds.length
          ? await tx
              .select()
              .from(proposalOptions)
              .where(inArray(proposalOptions.proposalVersionId, versionIds))
              .orderBy(proposalOptions.sortOrder)
          : [];
        const optionsByVersion = new Map<string, OptionRow[]>();
        for (const o of optionRows) {
          const arr = optionsByVersion.get(o.proposalVersionId) ?? [];
          arr.push(o);
          optionsByVersion.set(o.proposalVersionId, arr);
        }
        return list.map((p) => {
          const v = p.currentVersionId ? versionById.get(p.currentVersionId) : undefined;
          return proposalDto(
            p,
            v ? versionDto(v, optionsByVersion.get(v.id) ?? [], p.currency) : null,
          );
        });
      });
      return { items, nextCursor: null };
    },
  );

  app.post(
    '/proposals',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['proposals'],
        summary: 'Create a proposal with its first draft version and options',
        body: CreateProposalRequestSchema,
        response: { 201: ProposalSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const created = await tenantTx(request, async (tx) => {
        const [customer] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.orgId, org.orgId),
              eq(customers.id, request.body.customerId),
              isNull(customers.deletedAt),
            ),
          )
          .limit(1);
        if (!customer) throw problem('validation_failed', 'That customer does not exist in this company.');
        if (request.body.contactId) {
          const [contact] = await tx
            .select({ id: contacts.id, customerId: contacts.customerId })
            .from(contacts)
            .where(
              and(
                eq(contacts.orgId, org.orgId),
                eq(contacts.id, request.body.contactId),
                isNull(contacts.deletedAt),
              ),
            )
            .limit(1);
          if (!contact) throw problem('validation_failed', 'That contact does not exist in this company.');
          if (contact.customerId && contact.customerId !== request.body.customerId) {
            throw problem('validation_failed', 'That contact does not belong to the selected customer.');
          }
        }
        if (request.body.jobId) {
          const [job] = await tx
            .select({ id: jobs.id })
            .from(jobs)
            .where(and(eq(jobs.orgId, org.orgId), eq(jobs.id, request.body.jobId), isNull(jobs.deletedAt)))
            .limit(1);
          if (!job) throw problem('validation_failed', 'That job does not exist in this company.');
        }
        const [proposal] = await tx
          .insert(proposals)
          .values({
            orgId: org.orgId,
            number: 'PROP-' + randomUUID().slice(0, 8).toUpperCase(),
            customerId: request.body.customerId,
            contactId: request.body.contactId ?? null,
            jobId: request.body.jobId ?? null,
            title: request.body.title,
            expiresOn: request.body.expiresOn ?? null,
          })
          .returning();
        if (!proposal) throw problem('internal');
        const totals = computeTotals(request.body.options, 0);
        const [version] = await tx
          .insert(proposalVersions)
          .values({
            orgId: org.orgId,
            proposalId: proposal.id,
            versionNumber: 1,
            content: request.body.content,
            subtotalMinor: totals.subtotalMinor,
            totalMinor: totals.totalMinor,
            depositMinor: request.body.depositMinor ?? null,
          })
          .returning();
        if (!version) throw problem('internal');
        const options: OptionRow[] = [];
        for (const [index, input] of request.body.options.entries()) {
          const [row] = await tx
            .insert(proposalOptions)
            .values({
              orgId: org.orgId,
              proposalVersionId: version.id,
              key: input.key,
              kind: input.kind,
              tier: input.tier ?? null,
              label: input.label,
              description: input.description ?? null,
              estimateRevisionId: input.estimateRevisionId ?? null,
              lines: [],
              amountMinor: input.amountMinor,
              isDefault: input.isDefault,
              sortOrder: index,
            })
            .returning();
          if (row) options.push(row);
        }
        const [linked] = await tx
          .update(proposals)
          .set({ currentVersionId: version.id, updatedAt: new Date() })
          .where(eq(proposals.id, proposal.id))
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'proposal.created',
          resourceType: 'proposal',
          resourceId: proposal.id,
          after: { number: proposal.number, title: proposal.title },
        });
        return proposalDto(linked ?? proposal, versionDto(version, options, proposal.currency));
      });
      reply.code(201);
      return created;
    },
  );

  app.get(
    '/proposals/:id',
    {
      config: { permission: READ },
      schema: {
        tags: ['proposals'],
        summary: 'One proposal with its current version',
        params: IdParams,
        response: { 200: ProposalSchema },
      },
    },
    async (request) => {
      const actor = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await assertSalesProposalAccess(tx, actor, request.params.id);
        return loadProposalDetail(tx, actor.orgId, request.params.id);
      });
    },
  );

  app.patch(
    '/proposals/:id/versions/:versionId',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['proposals'],
        summary: 'Edit a draft version (content, options, entered tax/deposit)',
        params: VersionParams,
        body: UpdateProposalVersionRequestSchema,
        response: { 200: ProposalSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await assertSalesProposalAccess(tx, org, request.params.id);
        const [version] = await tx
          .select()
          .from(proposalVersions)
          .where(
            and(
              eq(proposalVersions.orgId, org.orgId),
              eq(proposalVersions.id, request.params.versionId),
              eq(proposalVersions.proposalId, request.params.id),
            ),
          )
          .limit(1);
        if (!version) throw problem('not_found');
        await assertProposalRevisionWritable(tx, org.orgId, request.params.id);
        if (version.status !== 'draft') {
          throw problem('conflict', 'A sent version is locked. Start a new draft version to change it.');
        }
        let options: OptionRow[] = await tx
          .select()
          .from(proposalOptions)
          .where(eq(proposalOptions.proposalVersionId, version.id))
          .orderBy(proposalOptions.sortOrder);
        if (request.body.options) {
          await tx.delete(proposalOptions).where(eq(proposalOptions.proposalVersionId, version.id));
          const inserted: OptionRow[] = [];
          for (const [index, input] of request.body.options.entries()) {
            const [row] = await tx
              .insert(proposalOptions)
              .values({
                orgId: org.orgId,
                proposalVersionId: version.id,
                key: input.key,
                kind: input.kind,
                tier: input.tier ?? null,
                label: input.label,
                description: input.description ?? null,
                estimateRevisionId: input.estimateRevisionId ?? null,
                lines: [],
                amountMinor: input.amountMinor,
                isDefault: input.isDefault,
                sortOrder: index,
              })
              .returning();
            if (row) inserted.push(row);
          }
          options = inserted;
        }
        const optionInputs: CreateProposalOptionInput[] =
          request.body.options ??
          options.map((o) => ({
            key: o.key,
            kind: o.kind,
            tier: o.tier ?? undefined,
            label: o.label,
            description: o.description ?? undefined,
            estimateRevisionId: o.estimateRevisionId ?? undefined,
            amountMinor: o.amountMinor,
            isDefault: o.isDefault,
          }));
        const taxMinor = request.body.taxMinor ?? version.taxMinor;
        const totals = computeTotals(optionInputs, taxMinor);
        const [next] = await tx
          .update(proposalVersions)
          .set({
            content: request.body.content ?? version.content,
            taxMinor,
            depositMinor:
              request.body.depositMinor === undefined ? version.depositMinor : request.body.depositMinor,
            subtotalMinor: totals.subtotalMinor,
            totalMinor: totals.totalMinor,
            revision: version.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(proposalVersions.id, version.id))
          .returning();
        if (!next) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'proposal.version_edited',
          resourceType: 'proposal_version',
          resourceId: next.id,
          after: { totalMinor: next.totalMinor },
        });
        return loadProposalDetail(tx, org.orgId, request.params.id);
      });
    },
  );

  app.post(
    '/proposals/:id/versions',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['proposals'],
        summary: 'Start a new draft version (copies the current one; the old draft is superseded)',
        params: IdParams,
        response: { 201: ProposalSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const created = await tenantTx(request, async (tx) => {
        await assertSalesProposalAccess(tx, org, request.params.id);
        const [proposal] = await tx
          .select()
          .from(proposals)
          .where(and(eq(proposals.orgId, org.orgId), eq(proposals.id, request.params.id)))
          .limit(1);
        if (!proposal) throw problem('not_found');
        await assertProposalRevisionWritable(tx, org.orgId, proposal.id);
        if (['accepted', 'voided'].includes(proposal.status)) {
          throw problem('conflict', `A ${proposal.status} proposal cannot get a new version.`);
        }
        const [current] = proposal.currentVersionId
          ? await tx
              .select()
              .from(proposalVersions)
              .where(eq(proposalVersions.id, proposal.currentVersionId))
              .limit(1)
          : [null];
        const nextNumber = (current?.versionNumber ?? 0) + 1;
        if (current && current.status === 'draft') {
          await tx
            .update(proposalVersions)
            .set({ status: 'superseded', updatedAt: new Date() })
            .where(eq(proposalVersions.id, current.id));
        }
        const [version] = await tx
          .insert(proposalVersions)
          .values({
            orgId: org.orgId,
            proposalId: proposal.id,
            versionNumber: nextNumber,
            content: current?.content ?? {},
            taxMinor: current?.taxMinor ?? 0,
            depositMinor: current?.depositMinor ?? null,
            subtotalMinor: current?.subtotalMinor ?? 0,
            totalMinor: current?.totalMinor ?? 0,
          })
          .returning();
        if (!version) throw problem('internal');
        if (current) {
          const old = await tx
            .select()
            .from(proposalOptions)
            .where(eq(proposalOptions.proposalVersionId, current.id))
            .orderBy(proposalOptions.sortOrder);
          for (const o of old) {
            await tx.insert(proposalOptions).values({
              orgId: org.orgId,
              proposalVersionId: version.id,
              key: o.key,
              kind: o.kind,
              tier: o.tier,
              label: o.label,
              description: o.description,
              estimateRevisionId: o.estimateRevisionId,
              lines: o.lines,
              amountMinor: o.amountMinor,
              isDefault: o.isDefault,
              sortOrder: o.sortOrder,
            });
          }
        }
        await tx
          .update(proposals)
          .set({ currentVersionId: version.id, status: 'draft', updatedAt: new Date() })
          .where(eq(proposals.id, proposal.id));
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'proposal.version_created',
          resourceType: 'proposal_version',
          resourceId: version.id,
          after: { versionNumber: nextNumber },
        });
        return loadProposalDetail(tx, org.orgId, proposal.id);
      });
      reply.code(201);
      return created;
    },
  );

  app.post(
    '/proposals/:id/send',
    {
      config: { permission: SEND, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['proposals'],
        summary: 'Send a draft version (locks it; emails the recipients when email is connected)',
        params: IdParams,
        body: SendProposalRequestSchema,
        response: { 200: ProposalSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const connected = emailConfigured(request.server.config);
      return tenantTx(request, async (tx) => {
        await assertSalesProposalAccess(tx, org, request.params.id);
        const [proposal] = await tx
          .select()
          .from(proposals)
          .where(and(eq(proposals.orgId, org.orgId), eq(proposals.id, request.params.id)))
          .limit(1);
        if (!proposal) throw problem('not_found');
        const [version] = await tx
          .select()
          .from(proposalVersions)
          .where(
            and(
              eq(proposalVersions.id, request.body.versionId),
              eq(proposalVersions.proposalId, proposal.id),
            ),
          )
          .limit(1);
        if (!version) throw problem('not_found');
        if (version.status !== 'draft') {
          throw problem('conflict', 'This version was already sent. Start a new draft to send changes.');
        }
        const now = new Date();
        const [next] = await tx
          .update(proposalVersions)
          .set({
            status: 'sent',
            sentAt: now,
            sentByUserId: org.userId,
            emailState: connected ? 'queued' : 'not_connected',
            emailNote: connected ? null : EMAIL_NOT_CONNECTED_NOTE,
            updatedAt: now,
          })
          .where(eq(proposalVersions.id, version.id))
          .returning();
        if (!next) throw problem('internal');
        await tx
          .update(proposals)
          .set({ status: 'sent', currentVersionId: next.id, updatedAt: now })
          .where(eq(proposals.id, proposal.id));
        if (connected) {
          await enqueue(tx, {
            orgId: org.orgId,
            task: 'proposal.email',
            aggregateType: 'proposal_version',
            aggregateId: next.id,
            payload: {
              proposalVersionId: next.id,
              senderUserId: org.userId,
              recipientContactIds: request.body.recipientContactIds,
              message: request.body.message ?? null,
            },
            jobKey: `proposal-email:${next.id}`,
          });
        }
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'proposal.sent',
          resourceType: 'proposal',
          resourceId: proposal.id,
          after: { versionNumber: next.versionNumber, emailState: next.emailState },
        });
        return loadProposalDetail(tx, org.orgId, proposal.id);
      });
    },
  );

  app.post(
    '/proposals/:id/accept',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['proposals'],
        summary: 'Record the customer’s selection and accept; creates + links a job when asked',
        params: IdParams,
        body: AcceptProposalRequestSchema,
        response: { 200: ProposalSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await assertSalesProposalAccess(tx, org, request.params.id);
        const [proposal] = await tx
          .select()
          .from(proposals)
          .where(and(eq(proposals.orgId, org.orgId), eq(proposals.id, request.params.id)))
          .limit(1);
        if (!proposal) throw problem('not_found');
        if (['accepted', 'voided', 'declined'].includes(proposal.status)) {
          throw problem('conflict', `A ${proposal.status} proposal cannot be accepted.`);
        }
        const [version] = await tx
          .select()
          .from(proposalVersions)
          .where(
            and(
              eq(proposalVersions.id, request.body.versionId),
              eq(proposalVersions.proposalId, proposal.id),
            ),
          )
          .limit(1);
        if (!version) throw problem('not_found');
        const options = await tx
          .select()
          .from(proposalOptions)
          .where(eq(proposalOptions.proposalVersionId, version.id));
        const byId = new Map(options.map((o) => [o.id, o]));
        const pkg = byId.get(request.body.packageOptionId);
        if (!pkg || pkg.kind !== 'package') {
          throw problem('validation_failed', 'The selected package is not an option on this version.');
        }
        let totalMinor = pkg.amountMinor + version.taxMinor;
        for (const id of request.body.addOnOptionIds) {
          const addOn = byId.get(id);
          if (!addOn || addOn.kind !== 'add_on') {
            throw problem('validation_failed', 'A selected add-on is not an option on this version.');
          }
          totalMinor += addOn.amountMinor;
        }
        const [selection] = await tx
          .insert(proposalSelections)
          .values({
            orgId: org.orgId,
            proposalVersionId: version.id,
            packageOptionId: pkg.id,
            addOnOptionIds: request.body.addOnOptionIds,
            totalMinor,
            selectedVia: 'staff',
            selectedByContactId: proposal.contactId,
          })
          .returning();
        if (!selection) throw problem('internal');

        let jobId = proposal.jobId;
        let budgetLinesSeeded = 0;
        if (!jobId && request.body.createJob) {
          if (!request.body.productLine) {
            throw problem('validation_failed', 'Pick a product line for the job this proposal creates.');
          }
          const [job] = await tx
            .insert(jobs)
            .values({
              orgId: org.orgId,
              number: 'JOB-' + randomUUID().slice(0, 8).toUpperCase(),
              title: proposal.title.slice(0, 180),
              productLine: request.body.productLine,
              origin: 'estimate',
              customerId: proposal.customerId,
              contactId: proposal.contactId,
              estimatedValueMinor: totalMinor,
              stageKey: 'intake',
              status: 'open',
            })
            .returning();
          if (!job) throw problem('internal');
          jobId = job.id;

          // Seed the job's budget from the accepted options' estimate lines (package +
          // add-ons). Unpriced lines are skipped; when an option carries no estimate
          // revision, nothing is seeded for it — amounts are never invented.
          const acceptedOptions = [
            pkg,
            ...request.body.addOnOptionIds
              .map((id) => byId.get(id))
              .filter((o): o is OptionRow => Boolean(o)),
          ];
          const revisionIds = [
            ...new Set(
              acceptedOptions
                .map((o) => o.estimateRevisionId)
                .filter((id): id is string => Boolean(id)),
            ),
          ];
          if (revisionIds.length > 0) {
            const revisions = await tx
              .select()
              .from(estimateRevisions)
              .where(
                and(
                  eq(estimateRevisions.orgId, org.orgId),
                  inArray(estimateRevisions.id, revisionIds),
                ),
              );
            const allLines = revisions.flatMap((r) => (Array.isArray(r.lines) ? r.lines : []));
            const seeded = budgetLinesFromEstimateLines(allLines);
            for (const line of seeded.lines) {
              await tx
                .insert(jobCostBudgets)
                .values({
                  orgId: org.orgId,
                  jobId: job.id,
                  costCode: line.costCode,
                  label: line.label,
                  budgetMinor: line.budgetMinor,
                })
                .onConflictDoNothing();
              budgetLinesSeeded += 1;
            }
            // Link the estimates to the job they became (only when unset).
            const estimateIds = [...new Set(revisions.map((r) => r.estimateId))];
            await tx
              .update(estimates)
              .set({ jobId: job.id, updatedAt: new Date() })
              .where(
                and(
                  eq(estimates.orgId, org.orgId),
                  inArray(estimates.id, estimateIds),
                  isNull(estimates.jobId),
                ),
              );
          }
        }
        const now = new Date();
        await tx
          .update(proposalVersions)
          .set({ status: 'accepted', updatedAt: now })
          .where(eq(proposalVersions.id, version.id));
        await tx
          .update(proposals)
          .set({ status: 'accepted', acceptedVersionId: version.id, jobId, updatedAt: now })
          .where(eq(proposals.id, proposal.id));
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'proposal.accepted',
          resourceType: 'proposal',
          resourceId: proposal.id,
          after: { totalMinor, jobId, budgetLinesSeeded },
        });
        return loadProposalDetail(tx, org.orgId, proposal.id);
      });
    },
  );

  app.post(
    '/proposals/:id/decline',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['proposals'],
        summary: 'Mark the proposal declined by the customer',
        params: IdParams,
        response: { 200: ProposalSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await assertSalesProposalAccess(tx, org, request.params.id);
        const [proposal] = await tx
          .select()
          .from(proposals)
          .where(and(eq(proposals.orgId, org.orgId), eq(proposals.id, request.params.id)))
          .limit(1);
        if (!proposal) throw problem('not_found');
        if (['accepted', 'voided'].includes(proposal.status)) {
          throw problem('conflict', `A ${proposal.status} proposal cannot be declined.`);
        }
        const now = new Date();
        if (proposal.currentVersionId) {
          await tx
            .update(proposalVersions)
            .set({ status: 'declined', updatedAt: now })
            .where(
              and(
                eq(proposalVersions.id, proposal.currentVersionId),
                eq(proposalVersions.status, 'sent'),
              ),
            );
        }
        await tx
          .update(proposals)
          .set({ status: 'declined', updatedAt: now })
          .where(eq(proposals.id, proposal.id));
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'proposal.declined',
          resourceType: 'proposal',
          resourceId: proposal.id,
        });
        return loadProposalDetail(tx, org.orgId, proposal.id);
      });
    },
  );

  app.post(
    '/proposals/:id/void',
    {
      config: { permission: VOID },
      schema: {
        tags: ['proposals'],
        summary: 'Void the proposal',
        params: IdParams,
        response: { 200: ProposalSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await assertSalesProposalAccess(tx, org, request.params.id);
        const [proposal] = await tx
          .select()
          .from(proposals)
          .where(and(eq(proposals.orgId, org.orgId), eq(proposals.id, request.params.id)))
          .limit(1);
        if (!proposal) throw problem('not_found');
        if (proposal.status === 'accepted') {
          throw problem('conflict', 'An accepted proposal cannot be voided.');
        }
        await tx
          .update(proposals)
          .set({ status: 'voided', updatedAt: new Date() })
          .where(eq(proposals.id, proposal.id));
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'proposal.voided',
          resourceType: 'proposal',
          resourceId: proposal.id,
        });
        return loadProposalDetail(tx, org.orgId, proposal.id);
      });
    },
  );

  app.get(
    '/proposals/:id/selection',
    {
      config: { permission: READ },
      schema: {
        tags: ['proposals'],
        summary: 'The recorded customer selection for the accepted version (404 until accepted)',
        params: IdParams,
        response: { 200: ProposalSelectionSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { orgId } = org;
      return tenantTx(request, async (tx) => {
        await assertSalesProposalAccess(tx, org, request.params.id);
        const [proposal] = await tx
          .select()
          .from(proposals)
          .where(and(eq(proposals.orgId, orgId), eq(proposals.id, request.params.id)))
          .limit(1);
        if (!proposal?.acceptedVersionId) throw problem('not_found');
        const [selection] = await tx
          .select()
          .from(proposalSelections)
          .where(eq(proposalSelections.proposalVersionId, proposal.acceptedVersionId))
          .limit(1);
        if (!selection) throw problem('not_found');
        return {
          id: selection.id,
          versionId: selection.proposalVersionId,
          packageOptionId: selection.packageOptionId,
          addOnOptionIds: selection.addOnOptionIds ?? [],
          total: money(selection.totalMinor, proposal.currency),
          selectedVia: selection.selectedVia === 'portal' ? ('portal' as const) : ('staff' as const),
          selectedAt: selection.selectedAt.toISOString(),
        };
      });
    },
  );

  app.get(
    '/proposals/email-status',
    {
      config: { permission: READ },
      schema: {
        tags: ['proposals'],
        summary: 'Whether proposal email can actually go out right now',
        response: { 200: ProposalEmailStatusSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const connected = emailConfigured(request.server.config);
      return {
        emailConnected: connected,
        message: connected
          ? 'Email is connected — sending a proposal emails the customer contact.'
          : EMAIL_NOT_CONNECTED_NOTE,
      };
    },
  );
};

export default proposalsModule;
