// `invoices` module (workstream 07 "Outgoing invoices and accounts receivable", OPS-068).
//
// An invoice is a financial artifact, never an editable message:
//   draft -> issued (delivered to a connected company's bill workflow) -> paid / void
// Draft lines can be corrected. Once delivered, the recipient's bill and the issuer's invoice are
// separate records; a correction after delivery is a credit note (workstream 09, not built yet),
// so void is limited to drafts that never left the company.
import {
  CreateNetworkInvoiceRequestSchema,
  InvoiceStatusSchema,
  IssuedInvoiceListSchema,
  IssuedInvoiceSchema,
  SendInvoiceRequestSchema,
  UuidSchema,
  invoiceMachine,
  invoiceTotals,
} from '@fieldline/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  companyConnections,
  invoiceLines,
  invoices,
  networkBills,
  networkProjects,
  organizations,
} from '../../db/schema';
import { platformTx, requireOrg, tenantTx } from '../../http/context';
import type { Tx } from '../../db/runtime';
import { beforeCursor, decodeCursor, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import {
  issuedInvoiceDto,
  loadIssuedInvoice,
  notifyCompany,
  todayIso,
} from '../../services/invoice-exchange';

/** Human-readable, per-company sequence. The advisory lock makes concurrent creates serialize. */
async function nextInvoiceNumber(tx: Tx, orgId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoices:${orgId}`}))`);
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(eq(invoices.orgId, orgId));
  const sequence = (row?.count ?? 0) + 1;
  return `INV-${new Date().getFullYear()}-${String(sequence).padStart(4, '0')}`;
}

const ListQuerySchema = z.object({
  status: InvoiceStatusSchema.optional(),
  recipientOrgId: UuidSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const invoicesModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/invoices',
    {
      config: { permission: 'invoice:write' },
      schema: {
        tags: ['invoices'],
        summary: 'Create a draft invoice addressed to a connected company',
        body: CreateNetworkInvoiceRequestSchema,
        response: { 201: IssuedInvoiceSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const totals = invoiceTotals(body.lines, body.taxRate);

      const created = await tenantTx(request, async (tx) => {
        // The recipient must be a company we have an active, invoice-scoped connection with.
        const [connection] = await tx
          .select()
          .from(companyConnections)
          .where(
            and(
              eq(companyConnections.orgId, org.orgId),
              eq(companyConnections.partnerOrgId, body.recipientOrgId),
              eq(companyConnections.status, 'active'),
            ),
          )
          .limit(1);
        if (!connection || !connection.scopes.includes('invoices')) {
          throw problem(
            'forbidden',
            'Connect with this company and grant the invoice scope before issuing an invoice to it.',
          );
        }
        const [ownCompany] = await tx
          .select({ currency: organizations.currency })
          .from(organizations)
          .where(eq(organizations.id, org.orgId))
          .limit(1);
        if (!ownCompany) throw problem('not_found');

        let projectName: string | null = null;
        if (body.projectId) {
          const [project] = await tx
            .select({ id: networkProjects.id, name: networkProjects.name })
            .from(networkProjects)
            .where(
              and(
                eq(networkProjects.orgId, org.orgId),
                eq(networkProjects.id, body.projectId),
                eq(networkProjects.partnerOrgId, body.recipientOrgId),
              ),
            )
            .limit(1);
          if (!project) throw problem('not_found', 'That shared project was not found for this company.');
          projectName = project.name;
        }

        const number = await nextInvoiceNumber(tx, org.orgId);
        const [invoice] = await tx
          .insert(invoices)
          .values({
            orgId: org.orgId,
            number,
            kind: 'standalone',
            status: 'draft',
            deliveryStatus: 'draft',
            recipientOrgId: body.recipientOrgId,
            recipientName: connection.partnerDisplayName,
            networkProjectId: body.projectId ?? null,
            currency: ownCompany.currency,
            subtotalMinor: totals.subtotalMinor,
            taxMinor: totals.taxMinor,
            totalMinor: totals.totalMinor,
            dueOn: body.dueOn,
            memo: body.memo ?? null,
          })
          .returning();
        if (!invoice) throw problem('internal');

        const insertedLines = await tx
          .insert(invoiceLines)
          .values(
            body.lines.map((line, index) => ({
              orgId: org.orgId,
              invoiceId: invoice.id,
              sortOrder: index,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPriceMinor: line.unitPriceMinor,
              amountMinor: totals.amounts[index] ?? 0,
            })),
          )
          .returning();

        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'invoice.created',
          resourceType: 'invoice',
          resourceId: invoice.id,
          after: issuedInvoiceDto(invoice, insertedLines, projectName),
        });
        return issuedInvoiceDto(invoice, insertedLines, projectName);
      });

      reply.status(201);
      return created;
    },
  );

  app.get(
    '/invoices',
    {
      config: { permission: 'invoice:read' },
      schema: {
        tags: ['invoices'],
        summary: 'Invoices this company issued (newest first)',
        querystring: ListQuerySchema,
        response: { 200: IssuedInvoiceListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, status, recipientOrgId } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const rows = await tenantTx(request, (tx) => {
        const filters = [
          eq(invoices.orgId, org.orgId),
          ...(status ? [eq(invoices.status, status)] : []),
          ...(recipientOrgId ? [eq(invoices.recipientOrgId, recipientOrgId)] : []),
        ];
        const cursorFilter = beforeCursor(invoices.createdAt, invoices.id, cursor);
        return tx
          .select()
          .from(invoices)
          .where(and(...filters, ...(cursorFilter ? [cursorFilter] : [])))
          .orderBy(desc(invoices.createdAt), desc(invoices.id))
          .limit(limit + 1);
      });
      const page = pageResult(
        rows,
        limit,
        (row) => ({ at: row.createdAt, id: row.id }),
        (row) => row,
      );
      const ids = page.items.map((row) => row.id);
      const lines = ids.length
        ? await tenantTx(request, (tx) =>
            tx.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids)),
          )
        : [];
      const byInvoice = new Map<string, typeof lines>();
      for (const line of lines) {
        const bucket = byInvoice.get(line.invoiceId) ?? [];
        bucket.push(line);
        byInvoice.set(line.invoiceId, bucket);
      }
      return {
        items: page.items.map((row) =>
          issuedInvoiceDto(
            row,
            (byInvoice.get(row.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
            null,
          ),
        ),
        nextCursor: page.nextCursor,
      };
    },
  );

  app.get(
    '/invoices/:invoiceId',
    {
      config: { permission: 'invoice:read' },
      schema: {
        tags: ['invoices'],
        summary: 'One invoice with its frozen lines',
        params: z.object({ invoiceId: UuidSchema }),
        response: { 200: IssuedInvoiceSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const invoice = await tenantTx(request, (tx) =>
        loadIssuedInvoice(tx, org.orgId, request.params.invoiceId),
      );
      if (!invoice) throw problem('not_found');
      return invoice;
    },
  );

  /**
   * Delivery crosses the tenant boundary: the recipient gets its own bill row in its own tenant.
   * That is one named platform transaction, and only an active two-sided connection with the
   * invoice scope allows it. Re-sending returns the existing delivery (idempotent by constraint).
   */
  app.post(
    '/invoices/:invoiceId/send',
    {
      config: { permission: 'invoice:issue' },
      schema: {
        tags: ['invoices'],
        summary: 'Issue the invoice and deliver it to the connected company',
        params: z.object({ invoiceId: UuidSchema }),
        body: SendInvoiceRequestSchema,
        response: { 200: IssuedInvoiceSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const invoiceId = request.params.invoiceId;

      return platformTx(
        request,
        'network.invoice_deliver',
        async (tx) => {
          const [invoice] = await tx
            .select()
            .from(invoices)
            .where(and(eq(invoices.orgId, org.orgId), eq(invoices.id, invoiceId)))
            .for('update');
          if (!invoice) throw problem('not_found');
          if (!invoice.recipientOrgId) {
            throw problem('conflict', 'This invoice has no recipient company to deliver it to.');
          }
          const [existingBill] = await tx
            .select({ id: networkBills.id })
            .from(networkBills)
            .where(
              and(
                eq(networkBills.orgId, invoice.recipientOrgId),
                eq(networkBills.invoiceId, invoice.id),
              ),
            )
            .limit(1);
          if (existingBill) {
            const dto = await loadIssuedInvoice(tx, org.orgId, invoice.id);
            if (!dto) throw problem('not_found');
            return dto;
          }
          if (invoice.deliveryStatus !== 'draft' || invoice.status !== 'draft') {
            throw problem('invalid_transition', `A ${invoice.deliveryStatus} invoice cannot be sent.`);
          }

          const [mine] = await tx
            .select()
            .from(companyConnections)
            .where(
              and(
                eq(companyConnections.orgId, org.orgId),
                eq(companyConnections.partnerOrgId, invoice.recipientOrgId),
                eq(companyConnections.status, 'active'),
              ),
            )
            .limit(1);
          const [theirs] = await tx
            .select({ id: companyConnections.id, scopes: companyConnections.scopes })
            .from(companyConnections)
            .where(
              and(
                eq(companyConnections.orgId, invoice.recipientOrgId),
                eq(companyConnections.partnerOrgId, org.orgId),
                eq(companyConnections.status, 'active'),
              ),
            )
            .limit(1);
          if (!mine || !theirs || !mine.scopes.includes('invoices') || !theirs.scopes.includes('invoices')) {
            throw problem(
              'conflict',
              'The connection with this company is no longer active for invoices. Reconnect first.',
            );
          }

          const [issuer] = await tx
            .select({ name: organizations.displayName, slug: organizations.slug })
            .from(organizations)
            .where(eq(organizations.id, org.orgId))
            .limit(1);
          if (!issuer) throw problem('not_found');

          const lines = await tx
            .select()
            .from(invoiceLines)
            .where(eq(invoiceLines.invoiceId, invoice.id))
            .orderBy(invoiceLines.sortOrder);
          let projectName: string | null = null;
          if (invoice.networkProjectId) {
            const [project] = await tx
              .select({ name: networkProjects.name })
              .from(networkProjects)
              .where(eq(networkProjects.id, invoice.networkProjectId))
              .limit(1);
            projectName = project?.name ?? null;
          }
          const issuedOn = invoice.issuedOn ?? todayIso();

          const [bill] = await tx
            .insert(networkBills)
            .values({
              orgId: invoice.recipientOrgId,
              invoiceId: invoice.id,
              issuerOrgId: org.orgId,
              issuerName: issuer.name,
              issuerSlug: issuer.slug,
              projectName,
              number: invoice.number,
              status: 'received',
              currency: invoice.currency,
              subtotalMinor: invoice.subtotalMinor,
              taxMinor: invoice.taxMinor,
              totalMinor: invoice.totalMinor,
              issuedOn,
              dueOn: invoice.dueOn,
              memo: invoice.memo,
              lines: lines.map((line) => ({
                description: line.description,
                quantity: line.quantity,
                unit: line.unit,
                unitPriceMinor: line.unitPriceMinor,
                amountMinor: line.amountMinor,
              })),
            })
            .returning();
          if (!bill) throw problem('internal');

          const now = new Date();
          const [updated] = await tx
            .update(invoices)
            .set({
              status: 'issued',
              deliveryStatus: 'sent',
              issuedOn,
              issuedAt: now,
              sentAt: now,
              revision: invoice.revision + 1,
            })
            .where(eq(invoices.id, invoice.id))
            .returning();
          if (!updated) throw problem('internal');

          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'invoice.sent',
            resourceType: 'invoice',
            resourceId: invoice.id,
            after: { status: 'issued', recipientOrgId: invoice.recipientOrgId, billId: bill.id },
            reason: request.body.message ?? null,
          });
          await auditRequest(request, tx, {
            orgId: invoice.recipientOrgId,
            action: 'bill.received',
            resourceType: 'network_bill',
            resourceId: bill.id,
            after: { number: bill.number, totalMinor: bill.totalMinor, currency: bill.currency },
          });
          await notifyCompany(tx, {
            orgId: invoice.recipientOrgId,
            category: 'invoice_received',
            title: `${issuer.name} sent invoice ${invoice.number}`,
            body: `${invoice.number} for ${(invoice.totalMinor / 100).toFixed(2)} ${invoice.currency} is in your bills. Review it and approve or dispute it.`,
            link: '/billing/bills',
            dedupeKey: `bill-received:${bill.id}`,
            correlationId: request.id,
          });

          const dto = await loadIssuedInvoice(tx, org.orgId, updated.id);
          if (!dto) throw problem('internal');
          return dto;
        },
        { orgId: org.orgId, userId: org.userId },
      );
    },
  );

  /**
   * Void a draft that was never delivered. A delivered invoice is corrected by a credit note, so
   * this route deliberately refuses once the recipient holds a bill.
   */
  app.post(
    '/invoices/:invoiceId/void',
    {
      config: { permission: 'invoice:void' },
      schema: {
        tags: ['invoices'],
        summary: 'Void a draft invoice that was never delivered',
        params: z.object({ invoiceId: UuidSchema }),
        body: z.object({ reason: z.string().trim().min(3).max(500) }),
        response: { 200: IssuedInvoiceSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { invoiceId } = request.params;
      return tenantTx(request, async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoices)
          .where(and(eq(invoices.orgId, org.orgId), eq(invoices.id, invoiceId)))
          .for('update');
        if (!invoice) throw problem('not_found');
        if (invoice.deliveryStatus !== 'draft') {
          throw problem(
            'invalid_transition',
            'This invoice has already been delivered. Issue a credit note instead of voiding it.',
          );
        }
        invoiceMachine.assertTransition(invoice.status, 'void');
        const [updated] = await tx
          .update(invoices)
          .set({
            status: 'void',
            deliveryStatus: 'void',
            voidedAt: new Date(),
            voidReason: request.body.reason,
            revision: invoice.revision + 1,
          })
          .where(eq(invoices.id, invoice.id))
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'invoice.voided',
          resourceType: 'invoice',
          resourceId: invoice.id,
          before: { status: invoice.status },
          after: { status: 'void' },
          reason: request.body.reason,
        });
        return loadIssuedInvoice(tx, org.orgId, updated!.id).then((dto) => {
          if (!dto) throw problem('internal');
          return dto;
        });
      });
    },
  );
};

export default invoicesModule;
