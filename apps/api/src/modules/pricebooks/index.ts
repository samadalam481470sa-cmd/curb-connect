// `pricebooks` module (CP-057, OPS-065, COS-226/COS-243 pricing): regional price books tied to
// service areas, immutable approved revisions (DB trigger + API check), items with category, unit,
// rate, source and price date, CSV import with a validation report, and a read-only resolver that
// discloses fallback, staleness and conflicts.
import {
  CreatePriceBookRequestSchema,
  CreatePriceBookRevisionRequestSchema,
  ImportPriceItemsRequestSchema,
  ImportReportSchema,
  PriceBookRevisionSchema,
  PriceBookSchema,
  PriceItemSchema,
  PriceSelectionSchema,
  ResolvePriceBookQuerySchema,
  UuidSchema,
} from '@fieldline/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { approvals, priceBookRevisions, priceBooks, priceItems } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { idempotent } from '../../http/idempotency';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { effectivePoint, loadProperty } from '../properties/service';
import {
  activeRevision,
  type ImportedItem,
  isoDate,
  type ItemRow,
  revisionItems,
  type RevisionRow,
  selectPriceBook,
  validateCsv,
} from './service';

const IdParams = z.object({ id: UuidSchema });
const ItemInputSchema = PriceItemSchema.omit({ id: true });

function itemDto(it: ItemRow) {
  return {
    id: it.id,
    code: it.code,
    label: it.label,
    category: it.category,
    costComponent: it.costComponent,
    unit: it.unit,
    unitRate: it.unitRate === null ? null : normalizeRate(it.unitRate),
    fixedAmountMinor: it.fixedAmountMinor,
    minimumQuantity: it.minimumQuantity === null ? null : normalizeRate(it.minimumQuantity),
    taxable: it.taxable,
    source: it.source,
    sourceRef: it.sourceRef,
    priceDate: it.priceDate,
  };
}

/** numeric(18,6) comes back as "20.000000"; keep 6 decimals (valid RateString). */
function normalizeRate(v: string): string {
  return v;
}

export function revisionDto(r: RevisionRow, items: ItemRow[]) {
  return {
    id: r.id,
    orgId: r.orgId,
    revision: r.revision,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    priceBookId: r.priceBookId,
    revisionNumber: r.revisionNumber,
    status: r.status,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    overheadRate: r.overheadRate ?? '0',
    contingencyRate: r.contingencyRate ?? '0',
    marginStrategy: r.marginStrategy,
    marginRate: r.marginRate ?? '0',
    taxRate: r.taxRate ?? '0',
    maxPriceAgeDays: r.maxPriceAgeDays,
    items: items.map(itemDto),
    approvedAt: r.approvedAt?.toISOString() ?? null,
  };
}

async function bookDto(tx: Tx, b: typeof priceBooks.$inferSelect) {
  const active = await activeRevision(tx, b.orgId, b.id, isoDate(new Date()));
  return {
    id: b.id,
    orgId: b.orgId,
    revision: b.revision,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    name: b.name,
    productLine: b.productLine,
    status: b.status,
    currency: b.currency,
    isSynthetic: b.isSynthetic,
    activeRevisionId: active?.id ?? null,
    region: b.region,
    serviceAreaId: b.serviceAreaId,
  };
}

async function loadRevision(tx: Tx, orgId: string, id: string, forUpdate = false) {
  const q = tx.select().from(priceBookRevisions).where(and(eq(priceBookRevisions.orgId, orgId), eq(priceBookRevisions.id, id)));
  const [row] = forUpdate ? await q.for('update') : await q;
  if (!row) throw problem('not_found');
  return row;
}

function assertDraft(r: RevisionRow) {
  // CP-057 D: approved revisions are immutable (the DB trigger enforces it too).
  if (r.status !== 'draft') throw problem('immutable_record', 'Only a draft revision can change. Create a new revision.');
}

async function replaceItems(tx: Tx, orgId: string, revisionId: string, items: (z.infer<typeof ItemInputSchema> | ImportedItem)[]) {
  await tx.delete(priceItems).where(and(eq(priceItems.orgId, orgId), eq(priceItems.priceBookRevisionId, revisionId)));
  let order = 0;
  for (const it of items) {
    await tx.insert(priceItems).values({
      orgId,
      priceBookRevisionId: revisionId,
      code: it.code,
      label: it.label,
      category: it.category,
      costComponent: it.costComponent,
      unit: it.unit,
      unitRate: it.unitRate,
      fixedAmountMinor: it.fixedAmountMinor,
      minimumQuantity: it.minimumQuantity,
      taxable: it.taxable,
      source: it.source ?? 'manual',
      sourceRef: it.sourceRef ?? null,
      priceDate: it.priceDate ?? null,
      sortOrder: order++,
    });
  }
}

const pricebooksModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/price-books',
    {
      config: { permission: 'price_book:write' },
      schema: { tags: ['pricebooks'], summary: 'Create a price book (optionally for a service area)', body: CreatePriceBookRequestSchema, response: { 201: PriceBookSchema } },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      return idempotent(request, reply, {}, async (tx) => {
        const [row] = await tx
          .insert(priceBooks)
          .values({
            orgId: org.orgId,
            name: request.body.name,
            productLine: request.body.productLine,
            currency: request.body.currency,
            region: request.body.region ?? null,
            serviceAreaId: request.body.serviceAreaId ?? null,
          })
          .returning();
        const out = await bookDto(tx, row!);
        await auditRequest(request, tx, { orgId: org.orgId, action: 'price_book.created', resourceType: 'price_book', resourceId: row!.id, after: out });
        return { status: 201, body: out };
      });
    },
  );

  app.get(
    '/price-books',
    {
      config: { permission: 'price_book:read' },
      schema: { tags: ['pricebooks'], summary: 'Price books', response: { 200: z.object({ items: z.array(PriceBookSchema), nextCursor: z.string().nullable() }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx.select().from(priceBooks).where(eq(priceBooks.orgId, org.orgId)).orderBy(asc(priceBooks.name));
        const items = [];
        for (const r of rows) items.push(await bookDto(tx, r));
        return { items, nextCursor: null };
      });
    },
  );

  app.get(
    '/price-books/resolve',
    {
      config: { permission: 'price_book:read' },
      schema: {
        tags: ['pricebooks'],
        summary: 'Which price book prices this property (narrowest area, disclosed fallback, staleness, conflicts)',
        querystring: ResolvePriceBookQuerySchema,
        response: { 200: PriceSelectionSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const p = await loadProperty(tx, org.orgId, request.query.propertyId);
        if (!p) throw problem('not_found');
        const pt = effectivePoint(p);
        const sel = await selectPriceBook(tx, {
          orgId: org.orgId,
          productLine: request.query.productLine,
          point: pt ? { lon: pt.coordinates[0], lat: pt.coordinates[1] } : null,
          today: isoDate(new Date()),
        });
        return sel.selection;
      });
    },
  );

  app.get(
    '/price-books/:id',
    {
      config: { permission: 'price_book:read' },
      schema: { tags: ['pricebooks'], summary: 'Price book with its revisions', params: IdParams, response: { 200: PriceBookSchema.extend({ revisions: z.array(PriceBookRevisionSchema.omit({ items: true })) }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [b] = await tx.select().from(priceBooks).where(and(eq(priceBooks.orgId, org.orgId), eq(priceBooks.id, request.params.id)));
        if (!b) throw problem('not_found');
        const revs = await tx.select().from(priceBookRevisions).where(and(eq(priceBookRevisions.orgId, org.orgId), eq(priceBookRevisions.priceBookId, b.id))).orderBy(asc(priceBookRevisions.revisionNumber));
        return { ...(await bookDto(tx, b)), revisions: revs.map((r) => { const { items: _i, ...rest } = revisionDto(r, []); return rest; }) };
      });
    },
  );

  app.post(
    '/price-books/:id/revisions',
    {
      config: { permission: 'price_book:write' },
      schema: { tags: ['pricebooks'], summary: 'Start a draft revision (copy-on-write)', params: IdParams, body: CreatePriceBookRevisionRequestSchema, response: { 201: PriceBookRevisionSchema } },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      return idempotent(request, reply, {}, async (tx) => {
        const [b] = await tx.select().from(priceBooks).where(and(eq(priceBooks.orgId, org.orgId), eq(priceBooks.id, request.params.id))).for('update');
        if (!b) throw problem('not_found');
        const [{ next }] = (await tx.execute<{ next: number }>(sql`select coalesce(max(revision_number), 0) + 1 as next from price_book_revisions where org_id = ${org.orgId} and price_book_id = ${b.id}`)) as unknown as [{ next: number }];
        const body = request.body;
        let base: RevisionRow | null = null;
        if (body.copyFromRevisionId) {
          base = await loadRevision(tx, org.orgId, body.copyFromRevisionId);
          if (base.priceBookId !== b.id) throw problem('validation_failed', 'copyFromRevisionId belongs to another price book.');
        }
        const [rev] = await tx
          .insert(priceBookRevisions)
          .values({
            orgId: org.orgId,
            priceBookId: b.id,
            revisionNumber: Number(next),
            status: 'draft',
            effectiveFrom: body.effectiveFrom ?? null,
            overheadRate: body.overheadRate ?? base?.overheadRate ?? '0',
            contingencyRate: body.contingencyRate ?? base?.contingencyRate ?? '0',
            marginStrategy: body.marginStrategy ?? base?.marginStrategy ?? 'target_margin',
            marginRate: body.marginRate ?? base?.marginRate ?? '0',
            taxRate: body.taxRate ?? base?.taxRate ?? '0',
            maxPriceAgeDays: body.maxPriceAgeDays ?? base?.maxPriceAgeDays ?? 180,
            createdByUserId: org.userId,
          })
          .returning();
        if (body.items) await replaceItems(tx, org.orgId, rev!.id, body.items);
        else if (base) {
          await replaceItems(tx, org.orgId, rev!.id, (await revisionItems(tx, org.orgId, base.id)).map((i) => ({ ...itemDto(i) })));
        }
        const out = revisionDto(rev!, await revisionItems(tx, org.orgId, rev!.id));
        await auditRequest(request, tx, { orgId: org.orgId, action: 'price_book_revision.created', resourceType: 'price_book_revision', resourceId: rev!.id, after: { ...out, items: out.items.length } });
        return { status: 201, body: out };
      });
    },
  );

  app.get(
    '/price-book-revisions/:id',
    {
      config: { permission: 'price_book:read' },
      schema: { tags: ['pricebooks'], summary: 'Revision with items', params: IdParams, response: { 200: PriceBookRevisionSchema } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const r = await loadRevision(tx, org.orgId, request.params.id);
        return revisionDto(r, await revisionItems(tx, org.orgId, r.id));
      });
    },
  );

  app.put(
    '/price-book-revisions/:id/items',
    {
      config: { permission: 'price_book:write' },
      schema: { tags: ['pricebooks'], summary: 'Replace the items of a draft revision', params: IdParams, body: z.object({ items: z.array(ItemInputSchema).max(2000) }), response: { 200: PriceBookRevisionSchema } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const r = await loadRevision(tx, org.orgId, request.params.id, true);
        assertDraft(r);
        const before = (await revisionItems(tx, org.orgId, r.id)).map(itemDto);
        await replaceItems(tx, org.orgId, r.id, request.body.items);
        await tx.update(priceBookRevisions).set({ revision: r.revision + 1 }).where(eq(priceBookRevisions.id, r.id));
        const out = revisionDto({ ...r, revision: r.revision + 1 }, await revisionItems(tx, org.orgId, r.id));
        await auditRequest(request, tx, { orgId: org.orgId, action: 'price_book_revision.items_replaced', resourceType: 'price_book_revision', resourceId: r.id, before: { items: before }, after: { items: out.items } });
        return out;
      });
    },
  );

  app.post(
    '/price-book-revisions/:id/import',
    {
      config: { permission: 'price_book:write' },
      schema: {
        tags: ['pricebooks'],
        summary: 'CSV import into a draft revision, with a validation report (nothing is applied if any row fails)',
        params: IdParams,
        body: ImportPriceItemsRequestSchema,
        response: { 200: ImportReportSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const r = await loadRevision(tx, org.orgId, request.params.id, true);
        assertDraft(r);
        const { report, items } = validateCsv(request.body.csv, request.body.dryRun);
        if (request.body.dryRun || report.errors.length > 0) return report;
        await replaceItems(tx, org.orgId, r.id, items);
        await tx.update(priceBookRevisions).set({ revision: r.revision + 1 }).where(eq(priceBookRevisions.id, r.id));
        await auditRequest(request, tx, { orgId: org.orgId, action: 'price_book_revision.csv_imported', resourceType: 'price_book_revision', resourceId: r.id, after: { rows: items.length, warnings: report.warnings.length } });
        return { ...report, applied: true };
      });
    },
  );

  app.post(
    '/price-book-revisions/:id/approve',
    {
      config: { permission: 'price_book:approve' },
      schema: {
        tags: ['pricebooks'],
        summary: 'Approve a draft revision (immutable afterwards; the previous approved revision is retired)',
        params: IdParams,
        body: z.object({ effectiveFrom: z.iso.date().optional(), comment: z.string().max(2000).optional() }).default({}),
        response: { 200: PriceBookRevisionSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      return idempotent(request, reply, {}, async (tx) => {
        const r = await loadRevision(tx, org.orgId, request.params.id, true);
        if (r.status !== 'draft' && r.status !== 'pending_approval') throw problem('invalid_transition', `Revision is ${r.status}.`);
        const items = await revisionItems(tx, org.orgId, r.id);
        if (items.length === 0) throw problem('validation_failed', 'A revision needs at least one priced item.');
        const today = isoDate(new Date());
        const effectiveFrom = request.body.effectiveFrom ?? r.effectiveFrom ?? today;
        // Retire the previously approved revision(s) of this book (status + effective_to only).
        await tx
          .update(priceBookRevisions)
          .set({ status: 'retired', effectiveTo: effectiveFrom })
          .where(and(eq(priceBookRevisions.orgId, org.orgId), eq(priceBookRevisions.priceBookId, r.priceBookId), eq(priceBookRevisions.status, 'approved')));
        const now = new Date();
        const [approved] = await tx
          .update(priceBookRevisions)
          .set({ status: 'approved', effectiveFrom, approvedAt: now, approvedByUserId: org.userId, revision: r.revision + 1 })
          .where(eq(priceBookRevisions.id, r.id))
          .returning();
        await tx.insert(approvals).values({
          orgId: org.orgId,
          subjectType: 'price_book_revision',
          subjectId: r.id,
          signoffRole: 'finance_approver',
          decision: 'approved',
          approverMembershipId: org.membershipId,
          ruleVersion: 'price-book-approval@1',
          evidence: { items: items.length, effectiveFrom },
          comment: request.body.comment ?? null,
          decidedAt: now,
        });
        const out = revisionDto(approved!, items);
        await auditRequest(request, tx, { orgId: org.orgId, action: 'price_book_revision.approved', resourceType: 'price_book_revision', resourceId: r.id, before: { status: r.status }, after: { status: 'approved', effectiveFrom } });
        return { status: 200, body: out };
      });
    },
  );
};

export default pricebooksModule;
