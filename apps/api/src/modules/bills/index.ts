// `bills` module (workstream 08 "Incoming invoices, bills and approvals" and 09 payments).
//
// The recipient owns its own record: it can approve, dispute or pay. Each decision commits together
// with the issuer's delivery state in one named platform transaction, so the two companies always
// agree about what happened without either reading the other's tenant.
import {
  ApproveBillRequestSchema,
  BillListSchema,
  BillSchema,
  BillStatusSchema,
  CreatePaymentLinkRequestSchema,
  DisputeBillRequestSchema,
  LedgerResponseSchema,
  PaymentLinkSchema,
  RecordSettlementRequestSchema,
  UuidSchema,
  invoiceMachine,
  nextBillActions,
} from '@fieldline/contracts';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { invoices, ledgerEntries, networkBills, networkPaymentLinks } from '../../db/schema';
import { platformTx, requireOrg, tenantTx } from '../../http/context';
import type { Tx } from '../../db/runtime';
import { beforeCursor, decodeCursor, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { billDto, notifyCompany, todayIso, type BillRow } from '../../services/invoice-exchange';

const BillIdParams = z.object({ billId: UuidSchema });

const BillsListQuery = z.object({
  status: BillStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function money(amountMinor: number, currency: string) {
  return { amountMinor, currency };
}

/**
 * Loads a bill that belongs to the caller's company. A bill id from another tenant is reported as
 * not found, never as forbidden, so the response cannot confirm that it exists elsewhere.
 */
async function loadOwnBill(
  tx: Tx,
  orgId: string,
  billId: string,
): Promise<BillRow> {
  const [bill] = await tx
    .select()
    .from(networkBills)
    .where(and(eq(networkBills.orgId, orgId), eq(networkBills.id, billId)))
    .for('update');
  if (!bill) throw problem('not_found');
  return bill;
}

const billsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/bills',
    {
      config: { permission: 'bill:read', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['bills'],
        summary: 'Bills other companies issued to this company (newest first)',
        querystring: BillsListQuery,
        response: { 200: BillListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, status } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const rows = await tenantTx(request, (tx) => {
        const cursorFilter = beforeCursor(networkBills.createdAt, networkBills.id, cursor);
        return tx
          .select()
          .from(networkBills)
          .where(
            and(
              eq(networkBills.orgId, org.orgId),
              ...(status ? [eq(networkBills.status, status)] : []),
              ...(cursorFilter ? [cursorFilter] : []),
            ),
          )
          .orderBy(desc(networkBills.createdAt), desc(networkBills.id))
          .limit(limit + 1);
      });
      const page = pageResult(
        rows,
        limit,
        (row) => ({ at: row.createdAt, id: row.id }),
        billDto,
      );
      return page;
    },
  );

  app.get(
    '/bills/:billId',
    {
      config: { permission: 'bill:read', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['bills'],
        summary: 'One received bill with the issuer’s frozen lines',
        params: BillIdParams,
        response: { 200: BillSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const [bill] = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(networkBills)
          .where(and(eq(networkBills.orgId, org.orgId), eq(networkBills.id, request.params.billId)))
          .limit(1),
      );
      if (!bill) throw problem('not_found');
      return billDto(bill);
    },
  );

  /** Opening a bill tells the issuer it was seen. Only the sent state moves; approval is explicit. */
  app.post(
    '/bills/:billId/view',
    {
      config: { permission: 'bill:read', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['bills'],
        summary: 'Mark a received bill as viewed for the issuer',
        params: BillIdParams,
        response: { 200: BillSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return platformTx(
        request,
        'network.bill_decide',
        async (tx) => {
          const bill = await loadOwnBill(tx, org.orgId, request.params.billId);
          await tx
            .update(invoices)
            .set({ deliveryStatus: 'viewed', revision: sql`${invoices.revision} + 1` })
            .where(
              and(
                eq(invoices.orgId, bill.issuerOrgId),
                eq(invoices.id, bill.invoiceId),
                eq(invoices.deliveryStatus, 'sent'),
              ),
            );
          return billDto(bill);
        },
        { orgId: org.orgId, userId: org.userId },
      );
    },
  );

  app.post(
    '/bills/:billId/approve',
    {
      config: { permission: 'bill:approve', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['bills'],
        summary: 'Approve a received bill; the issuer sees the approval immediately',
        params: BillIdParams,
        body: ApproveBillRequestSchema,
        response: { 200: BillSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return platformTx(
        request,
        'network.bill_decide',
        async (tx) => {
          const bill = await loadOwnBill(tx, org.orgId, request.params.billId);
          if (bill.status !== 'received') {
            throw problem('invalid_transition', `A ${bill.status} bill cannot be approved.`);
          }
          const now = new Date();
          const [updated] = await tx
            .update(networkBills)
            .set({
              status: 'approved',
              approvedAt: now,
              approvedByUserId: org.userId,
              revision: bill.revision + 1,
            })
            .where(eq(networkBills.id, bill.id))
            .returning();
          await tx
            .update(invoices)
            .set({
              deliveryStatus: 'approved',
              approvedAt: now,
              revision: sql`${invoices.revision} + 1`,
            })
            .where(and(eq(invoices.orgId, bill.issuerOrgId), eq(invoices.id, bill.invoiceId)));
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'bill.approved',
            resourceType: 'network_bill',
            resourceId: bill.id,
            before: { status: bill.status },
            after: { status: 'approved' },
            reason: request.body.comment ?? null,
          });
          await auditRequest(request, tx, {
            orgId: bill.issuerOrgId,
            action: 'invoice.approved',
            resourceType: 'invoice',
            resourceId: bill.invoiceId,
            after: { approvedByOrgId: org.orgId },
          });
          await notifyCompany(tx, {
            orgId: bill.issuerOrgId,
            category: 'invoice_approved',
            title: `${org.orgDisplayName} approved invoice ${bill.number}`,
            body: `Invoice ${bill.number} is approved and ready to be paid.`,
            link: `/billing/invoices/${bill.invoiceId}`,
            dedupeKey: `invoice-approved:${bill.id}`,
            correlationId: request.id,
          });
          return billDto(updated!);
        },
        { orgId: org.orgId, userId: org.userId },
      );
    },
  );

  app.post(
    '/bills/:billId/dispute',
    {
      config: { permission: 'bill:dispute', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['bills'],
        summary: 'Dispute a bill with a written reason the issuer can act on',
        params: BillIdParams,
        body: DisputeBillRequestSchema,
        response: { 200: BillSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return platformTx(
        request,
        'network.bill_decide',
        async (tx) => {
          const bill = await loadOwnBill(tx, org.orgId, request.params.billId);
          if (!nextBillActions(bill.status).includes('dispute')) {
            throw problem('invalid_transition', `A ${bill.status} bill cannot be disputed.`);
          }
          const now = new Date();
          const [updated] = await tx
            .update(networkBills)
            .set({
              status: 'disputed',
              disputeReason: request.body.reason,
              revision: bill.revision + 1,
            })
            .where(eq(networkBills.id, bill.id))
            .returning();
          await tx
            .update(invoices)
            .set({
              deliveryStatus: 'disputed',
              disputedAt: now,
              disputeReason: request.body.reason,
              revision: sql`${invoices.revision} + 1`,
            })
            .where(and(eq(invoices.orgId, bill.issuerOrgId), eq(invoices.id, bill.invoiceId)));
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'bill.disputed',
            resourceType: 'network_bill',
            resourceId: bill.id,
            before: { status: bill.status },
            after: { status: 'disputed' },
            reason: request.body.reason,
          });
          await auditRequest(request, tx, {
            orgId: bill.issuerOrgId,
            action: 'invoice.disputed',
            resourceType: 'invoice',
            resourceId: bill.invoiceId,
            after: { disputedByOrgId: org.orgId },
            reason: request.body.reason,
          });
          await notifyCompany(tx, {
            orgId: bill.issuerOrgId,
            category: 'invoice_disputed',
            title: `${org.orgDisplayName} disputed invoice ${bill.number}`,
            body: request.body.reason,
            link: `/billing/invoices/${bill.invoiceId}`,
            dedupeKey: `invoice-disputed:${bill.id}:${bill.revision}`,
            correlationId: request.id,
          });
          return billDto(updated!);
        },
        { orgId: org.orgId, userId: org.userId },
      );
    },
  );

  /**
   * A payment reference for the AP team. It is not a checkout: no card data is collected or stored,
   * and `provider: 'stand_in'` says plainly that no processor is connected.
   */
  app.post(
    '/bills/:billId/payment-link',
    {
      config: { permission: 'payment_link:create', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['bills'],
        summary: 'Create a payment reference for an approved bill (stand-in provider, no card data)',
        params: BillIdParams,
        body: CreatePaymentLinkRequestSchema,
        response: { 201: PaymentLinkSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + request.body.expiresInHours * 3_600_000);
      const link = await tenantTx(request, async (tx) => {
        const bill = await loadOwnBill(tx, org.orgId, request.params.billId);
        if (bill.status === 'paid' || bill.status === 'void') {
          throw problem('invalid_transition', `A ${bill.status} bill does not need a payment link.`);
        }
        const [existing] = await tx
          .select()
          .from(networkPaymentLinks)
          .where(
            and(
              eq(networkPaymentLinks.orgId, org.orgId),
              eq(networkPaymentLinks.billId, bill.id),
              eq(networkPaymentLinks.status, 'open'),
            ),
          )
          .limit(1);
        if (existing) return existing;
        const [inserted] = await tx
          .insert(networkPaymentLinks)
          .values({
            orgId: org.orgId,
            billId: bill.id,
            providerReference: `STD-${randomUUID().slice(0, 8).toUpperCase()}`,
            amountMinor: bill.totalMinor,
            currency: bill.currency,
            provider: 'stand_in',
            status: 'open',
            expiresAt,
          })
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'payment_link.created',
          resourceType: 'network_payment_link',
          resourceId: inserted!.id,
          after: { billId: bill.id, provider: 'stand_in', amountMinor: bill.totalMinor },
        });
        return inserted!;
      });
      reply.status(201);
      return {
        id: link.id,
        billId: link.billId,
        provider: link.provider,
        providerReference: link.providerReference,
        status: link.status,
        amount: money(link.amountMinor, link.currency),
        url: `/billing/bills`,
        expiresAt: link.expiresAt.toISOString(),
        paidAt: link.paidAt?.toISOString() ?? null,
        createdAt: link.createdAt.toISOString(),
      };
    },
  );

  /**
   * Settlement records that money moved. Until a processor is configured the accepted methods are
   * manual/stand-in, which the audit log records verbatim; the issuer's invoice and ledger are
   * updated in the same transaction so the two companies can never disagree about the balance.
   */
  app.post(
    '/bills/:billId/settle',
    {
      config: { permission: 'bill:pay', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['bills'],
        summary: 'Record settlement of an approved bill and post the issuer’s ledger entries',
        params: BillIdParams,
        body: RecordSettlementRequestSchema,
        response: { 200: BillSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return platformTx(
        request,
        'network.settle',
        async (tx) => {
          const bill = await loadOwnBill(tx, org.orgId, request.params.billId);
          if (bill.status === 'paid') return billDto(bill);
          if (bill.status !== 'approved') {
            throw problem('invalid_transition', 'Approve the bill before recording a payment.');
          }
          const [invoice] = await tx
            .select()
            .from(invoices)
            .where(and(eq(invoices.orgId, bill.issuerOrgId), eq(invoices.id, bill.invoiceId)))
            .for('update');
          if (!invoice) throw problem('not_found', 'The issuer’s invoice is no longer available.');
          invoiceMachine.assertTransition(invoice.status, 'paid');

          const now = new Date();
          const [updatedBill] = await tx
            .update(networkBills)
            .set({ status: 'paid', paidAt: now, revision: bill.revision + 1 })
            .where(eq(networkBills.id, bill.id))
            .returning();

          const transactionId = randomUUID();
          const memo = `${bill.number} settled by ${org.orgDisplayName} (${request.body.method}${
            request.body.reference ? ` ${request.body.reference}` : ''
          })`;
          await tx.insert(ledgerEntries).values([
            {
              orgId: bill.issuerOrgId,
              transactionId,
              account: 'cash',
              direction: 'debit',
              amountMinor: bill.totalMinor,
              currency: bill.currency,
              invoiceId: invoice.id,
              memo,
              postedAt: now,
            },
            {
              orgId: bill.issuerOrgId,
              transactionId,
              account: 'accounts_receivable',
              direction: 'credit',
              amountMinor: bill.totalMinor,
              currency: bill.currency,
              invoiceId: invoice.id,
              memo,
              postedAt: now,
            },
          ]);

          await tx
            .update(invoices)
            .set({
              status: 'paid',
              deliveryStatus: 'paid',
              amountPaidMinor: bill.totalMinor,
              revision: invoice.revision + 1,
            })
            .where(eq(invoices.id, invoice.id));

          await tx
            .update(networkPaymentLinks)
            .set({ status: 'paid', paidAt: now, revision: sql`${networkPaymentLinks.revision} + 1` })
            .where(
              and(
                eq(networkPaymentLinks.orgId, org.orgId),
                eq(networkPaymentLinks.billId, bill.id),
                eq(networkPaymentLinks.status, 'open'),
              ),
            );

          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'bill.paid',
            resourceType: 'network_bill',
            resourceId: bill.id,
            before: { status: bill.status },
            after: {
              status: 'paid',
              method: request.body.method,
              reference: request.body.reference ?? null,
              paidOn: request.body.paidOn ?? todayIso(),
            },
          });
          await auditRequest(request, tx, {
            orgId: bill.issuerOrgId,
            action: 'invoice.paid',
            resourceType: 'invoice',
            resourceId: invoice.id,
            before: { status: invoice.status, amountPaidMinor: invoice.amountPaidMinor },
            after: { status: 'paid', amountPaidMinor: bill.totalMinor, transactionId },
          });
          await notifyCompany(tx, {
            orgId: bill.issuerOrgId,
            category: 'invoice_paid',
            title: `${org.orgDisplayName} paid invoice ${bill.number}`,
            body: `${bill.number} settled in full. Two ledger entries were posted (cash and accounts receivable).`,
            link: `/billing/invoices/${invoice.id}`,
            dedupeKey: `invoice-paid:${bill.id}`,
            correlationId: request.id,
          });
          return billDto(updatedBill!);
        },
        { orgId: org.orgId, userId: org.userId },
      );
    },
  );

  /** The issuer's ledger, derived only from append-only entries. */
  app.get(
    '/ledger',
    {
      config: { permission: 'ledger:read' },
      schema: {
        tags: ['bills'],
        summary: 'Ledger entries posted for this company',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }),
        response: { 200: LedgerResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.orgId, org.orgId))
          .orderBy(desc(ledgerEntries.postedAt), desc(ledgerEntries.id))
          .limit(request.query.limit),
      );
      let debitsMinor = 0;
      let creditsMinor = 0;
      for (const row of rows) {
        if (row.direction === 'debit') debitsMinor += row.amountMinor;
        else creditsMinor += row.amountMinor;
      }
      const currency = rows[0]?.currency ?? 'USD';
      return {
        entries: rows.map((row) => ({
          id: row.id,
          transactionId: row.transactionId,
          account: row.account,
          direction: row.direction,
          amount: money(row.amountMinor, row.currency),
          invoiceId: row.invoiceId,
          memo: row.memo,
          postedAt: row.postedAt.toISOString(),
        })),
        totals: {
          debitsMinor,
          creditsMinor,
          currency,
          balanced: debitsMinor === creditsMinor,
        },
      };
    },
  );
};

export default billsModule;
