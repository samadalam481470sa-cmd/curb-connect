/**
 * `pricebooks` module: org price books + items. Seed-compatible with demo synthetic curb book.
 */
import {
  CostComponentSchema,
  CreatePriceBookRequestSchema,
  PageQuerySchema,
  PriceBookListSchema,
  PriceBookSchema,
  PriceItemCategorySchema,
  PriceItemSchema,
  PricingUnitSchema,
  UuidSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { priceBookRevisions, priceBooks, priceItems } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { PAGE_60_PRICE_ITEMS } from '../../db/seeds/demo';
import { requireOrg, tenantTx } from '../../http/context';
import { afterCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';

const IdParams = z.object({ id: UuidSchema });

const CreateItemSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]{2,40}$/),
  label: z.string().min(1).max(200),
  category: PriceItemCategorySchema,
  costComponent: CostComponentSchema,
  unit: PricingUnitSchema,
  unitRate: z.string().nullable().optional(),
  fixedAmountMinor: z.number().int().nullable().optional(),
  taxable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const PutItemsBodySchema = z.object({
  items: z.array(CreateItemSchema).min(1).max(500),
});

type BookRow = typeof priceBooks.$inferSelect;

function bookDto(row: BookRow, activeRevisionId: string | null) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    name: row.name,
    productLine: row.productLine,
    status: row.status,
    currency: row.currency,
    isSynthetic: row.isSynthetic,
    activeRevisionId,
  };
}

function itemDto(row: typeof priceItems.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    category: row.category,
    costComponent: row.costComponent,
    unit: row.unit,
    unitRate: row.unitRate,
    fixedAmountMinor: row.fixedAmountMinor,
    minimumQuantity: row.minimumQuantity,
    taxable: row.taxable,
  };
}

async function activeRevisionId(tx: Tx, orgId: string, bookId: string): Promise<string | null> {
  const [rev] = await tx
    .select({ id: priceBookRevisions.id })
    .from(priceBookRevisions)
    .where(
      and(
        eq(priceBookRevisions.orgId, orgId),
        eq(priceBookRevisions.priceBookId, bookId),
        eq(priceBookRevisions.status, 'approved'),
      ),
    )
    .orderBy(desc(priceBookRevisions.revisionNumber))
    .limit(1);
  return rev?.id ?? null;
}

const pricebooksModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/price-books',
    {
      config: { permission: 'price_book:read' },
      schema: {
        tags: ['pricebooks'],
        summary: 'List price books for the active org',
        querystring: PageQuerySchema,
        response: { 200: PriceBookListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, cursor } = request.query;
      const after = decodeCursor(cursor);
      const rows = await tenantTx(request, async (tx) => {
        const books = await tx
          .select()
          .from(priceBooks)
          .where(
            and(
              eq(priceBooks.orgId, org.orgId),
              afterCursor(priceBooks.createdAt, priceBooks.id, after),
            ),
          )
          .orderBy(asc(msTrunc(priceBooks.createdAt)), asc(priceBooks.id))
          .limit(limit + 1);
        const withRevs = await Promise.all(
          books.map(async (b) => ({
            book: b,
            activeRevisionId: await activeRevisionId(tx, org.orgId, b.id),
          })),
        );
        return withRevs;
      });
      return pageResult(
        rows,
        limit,
        (r) => ({ at: r.book.createdAt, id: r.book.id }),
        (r) => bookDto(r.book, r.activeRevisionId),
      );
    },
  );

  app.post(
    '/price-books',
    {
      config: { permission: 'price_book:write' },
      schema: {
        tags: ['pricebooks'],
        summary: 'Create a price book with draft revision (optionally seed curb page-60 items)',
        body: CreatePriceBookRequestSchema.extend({
          seedDemoItems: z.boolean().default(false),
          isSynthetic: z.boolean().default(false),
        }),
        response: { 201: PriceBookSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const dto = await tenantTx(request, async (tx) => {
        const [book] = await tx
          .insert(priceBooks)
          .values({
            orgId: org.orgId,
            name: body.name,
            productLine: body.productLine,
            currency: body.currency ?? 'USD',
            isSynthetic: body.isSynthetic || body.seedDemoItems,
          })
          .returning();
        const [rev] = await tx
          .insert(priceBookRevisions)
          .values({
            orgId: org.orgId,
            priceBookId: book!.id,
            revisionNumber: 1,
            status: 'draft',
            overheadRate: '0.100000',
            contingencyRate: '0',
            marginStrategy: 'target_margin',
            marginRate: '0.250000',
            taxRate: '0',
            notes: body.seedDemoItems
              ? 'Seeded synthetic page-60 rates. Never market pricing.'
              : null,
          })
          .returning();
        if (body.seedDemoItems && body.productLine === 'curb') {
          await tx.insert(priceItems).values(
            PAGE_60_PRICE_ITEMS.map((item, i) => ({
              orgId: org.orgId,
              priceBookRevisionId: rev!.id,
              sortOrder: i,
              taxable: false,
              ...item,
            })),
          );
          await tx
            .update(priceBookRevisions)
            .set({
              status: 'approved',
              approvedAt: new Date(),
              approvedByUserId: org.userId,
            })
            .where(eq(priceBookRevisions.id, rev!.id));
        }
        const out = bookDto(book!, rev!.status === 'approved' ? rev!.id : null);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'price_book.created',
          resourceType: 'price_book',
          resourceId: book!.id,
          after: out,
        });
        return out;
      });
      reply.status(201);
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  app.get(
    '/price-books/:id',
    {
      config: { permission: 'price_book:read' },
      schema: {
        tags: ['pricebooks'],
        summary: 'Get a price book',
        params: IdParams,
        response: { 200: PriceBookSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        const [book] = await tx
          .select()
          .from(priceBooks)
          .where(and(eq(priceBooks.orgId, org.orgId), eq(priceBooks.id, request.params.id)));
        if (!book) return null;
        return { book, activeRevisionId: await activeRevisionId(tx, org.orgId, book.id) };
      });
      if (!result) throw problem('not_found');
      setEtag(reply, result.book.revision);
      return bookDto(result.book, result.activeRevisionId);
    },
  );

  app.get(
    '/price-books/:id/items',
    {
      config: { permission: 'price_book:read' },
      schema: {
        tags: ['pricebooks'],
        summary: 'List items for the active (or latest draft) revision',
        params: IdParams,
        querystring: z.object({
          revisionId: UuidSchema.optional(),
        }),
        response: { 200: z.object({ revisionId: UuidSchema, items: z.array(PriceItemSchema) }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [book] = await tx
          .select()
          .from(priceBooks)
          .where(and(eq(priceBooks.orgId, org.orgId), eq(priceBooks.id, request.params.id)));
        if (!book) throw problem('not_found');
        let revisionId = request.query.revisionId ?? null;
        if (!revisionId) {
          revisionId = await activeRevisionId(tx, org.orgId, book.id);
          if (!revisionId) {
            const [draft] = await tx
              .select({ id: priceBookRevisions.id })
              .from(priceBookRevisions)
              .where(
                and(
                  eq(priceBookRevisions.orgId, org.orgId),
                  eq(priceBookRevisions.priceBookId, book.id),
                ),
              )
              .orderBy(desc(priceBookRevisions.revisionNumber))
              .limit(1);
            revisionId = draft?.id ?? null;
          }
        }
        if (!revisionId) return { revisionId: book.id, items: [] };
        const items = await tx
          .select()
          .from(priceItems)
          .where(
            and(
              eq(priceItems.orgId, org.orgId),
              eq(priceItems.priceBookRevisionId, revisionId),
            ),
          )
          .orderBy(asc(priceItems.sortOrder), asc(priceItems.code));
        return { revisionId, items: items.map(itemDto) };
      });
    },
  );

  app.put(
    '/price-books/:id/items',
    {
      config: { permission: 'price_book:write' },
      schema: {
        tags: ['pricebooks'],
        summary: 'Replace items on a draft revision (creates draft if only approved exists)',
        params: IdParams,
        body: PutItemsBodySchema,
        response: { 200: z.object({ revisionId: UuidSchema, items: z.array(PriceItemSchema) }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const body = request.body;
      return tenantTx(request, async (tx) => {
        const [book] = await tx
          .select()
          .from(priceBooks)
          .where(and(eq(priceBooks.orgId, org.orgId), eq(priceBooks.id, request.params.id)));
        if (!book) throw problem('not_found');

        const revs = await tx
          .select()
          .from(priceBookRevisions)
          .where(
            and(
              eq(priceBookRevisions.orgId, org.orgId),
              eq(priceBookRevisions.priceBookId, book.id),
            ),
          )
          .orderBy(desc(priceBookRevisions.revisionNumber));

        let draft = revs.find((r) => r.status === 'draft');
        if (!draft) {
          const latest = revs[0];
          const [created] = await tx
            .insert(priceBookRevisions)
            .values({
              orgId: org.orgId,
              priceBookId: book.id,
              revisionNumber: (latest?.revisionNumber ?? 0) + 1,
              status: 'draft',
              overheadRate: latest?.overheadRate ?? '0.100000',
              contingencyRate: latest?.contingencyRate ?? '0',
              marginStrategy: latest?.marginStrategy ?? 'target_margin',
              marginRate: latest?.marginRate ?? '0.250000',
              taxRate: latest?.taxRate ?? '0',
            })
            .returning();
          draft = created!;
        }

        await tx
          .delete(priceItems)
          .where(
            and(
              eq(priceItems.orgId, org.orgId),
              eq(priceItems.priceBookRevisionId, draft.id),
            ),
          );
        const inserted = await tx
          .insert(priceItems)
          .values(
            body.items.map((item, i) => ({
              orgId: org.orgId,
              priceBookRevisionId: draft!.id,
              code: item.code,
              label: item.label,
              category: item.category,
              costComponent: item.costComponent,
              unit: item.unit,
              unitRate: item.unitRate ?? null,
              fixedAmountMinor: item.fixedAmountMinor ?? null,
              taxable: item.taxable,
              sortOrder: item.sortOrder ?? i,
            })),
          )
          .returning();

        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'price_book.items_replaced',
          resourceType: 'price_book_revision',
          resourceId: draft.id,
          after: { itemCount: inserted.length },
        });

        return { revisionId: draft.id, items: inserted.map(itemDto) };
      });
    },
  );
};

export default pricebooksModule;
