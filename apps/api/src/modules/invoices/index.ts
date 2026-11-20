// `invoices` module (workstream 07 "Outgoing invoices and accounts receivable", OPS-068).
//
// An invoice is a financial artifact, never an editable message:
//   draft -> issued (delivered to a connected company's bill workflow) -> paid / void
// Draft lines can be corrected. Once delivered, the recipient's bill and the issuer's invoice are
// separate records; a correction after delivery is a credit note (workstream 09, not built yet),
// so void is limited to drafts that never left the company.
import {
  CreateNetworkInvoiceRequestSchema,
  EmailInvoiceRequestSchema,
  type IssuedInvoice,
  type MailboxRef,
  InvoiceStatusSchema,
  IssuedInvoiceListSchema,
  IssuedInvoiceSchema,
  SendInvoiceRequestSchema,
  UuidSchema,
  invoiceMachine,
  invoiceTotalsWithDiscount,
} from '@fieldline/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
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
import { assertCan, platformTx, requireOrg, tenantTx } from '../../http/context';
import { enqueue } from '../../jobs/outbox';
import type { Tx } from '../../db/runtime';
import { beforeCursor, decodeCursor, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import {
  type InvoiceRow,
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

/**
 * Mark the invoice's email as queued and enqueue the worker task in the same transaction
 * (transactional outbox). Each call bumps email_attempt so the attempt gets its own mail server
 * idempotency key: a retried job never sends twice, a deliberate resend is a new message.
 */
async function queueInvoiceEmail(
  tx: Tx,
  request: FastifyRequest,
  invoice: InvoiceRow,
  input: { recipientEmail: string; via: MailboxRef | null; senderUserId: string },
): Promise<void> {
  const attempt = invoice.emailAttempt + 1;
  await tx
    .update(invoices)
    .set({
      recipientEmail: input.recipientEmail,
      emailVia: input.via,
      emailStatus: 'queued',
      emailError: null,
      emailSentAt: null,
      emailSenderUserId: input.senderUserId,
      emailAttempt: attempt,
    })
    .where(and(eq(invoices.orgId, invoice.orgId), eq(invoices.id, invoice.id)));
  await enqueue(tx, {
    orgId: invoice.orgId,
    task: 'invoice.email',
    aggregateType: 'invoice',
    aggregateId: invoice.id,
    payload: { invoiceId: invoice.id, attempt },
    correlationId: request.id,
    jobKey: `invoice-email:${invoice.id}`,
  });
  await auditRequest(request, tx, {
    orgId: invoice.orgId,
    action: 'invoice.email_queued',
    resourceType: 'invoice',
    resourceId: invoice.id,
    after: { recipientEmail: input.recipientEmail, via: input.via, attempt },
  });
}

/**
 * Issue a draft and deliver it into the connected company's bill workflow, and queue its email
 * copy when a recipient address is known. Used by POST /invoices/:id/send and by POST /invoices
 * with autoSend. Re-sending an already delivered invoice returns it unchanged (idempotent).
 */
/**
 * Sends an invoice to an ordinary customer (not on Field Pro): it is issued and, when there is
 * an email address, emailed with the PDF from the sender's connected mailbox. Sending again
 * returns the invoice unchanged.
 */
async function deliverCustomerInvoice(
  tx: Tx,
  request: FastifyRequest,
  invoice: InvoiceRow,
  opts: {
    message?: string | undefined;
    recipientEmail?: string | undefined;
    sendVia?: MailboxRef | undefined;
  },
  org: { orgId: string; userId: string },
): Promise<IssuedInvoice> {
  if (invoice.status === 'draft') {
    const now = new Date();
    const issuedOn = invoice.issuedOn ?? todayIso();
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
      after: { status: 'issued', recipientName: invoice.recipientName },
      reason: opts.message ?? null,
    });
    const emailTo = opts.recipientEmail ?? invoice.recipientEmail;
    if (emailTo) {
      await queueInvoiceEmail(tx, request, updated, {
        recipientEmail: emailTo,
        via: opts.sendVia ?? updated.emailVia ?? null,
        senderUserId: org.userId,
      });
    }
  }
  const dto = await loadIssuedInvoice(tx, org.orgId, invoice.id);
  if (!dto) throw problem('internal');
  return dto;
}

async function deliverInvoice(
  request: FastifyRequest,
  invoiceId: string,
  opts: {
    message?: string | undefined;
    recipientEmail?: string | undefined;
    sendVia?: MailboxRef | undefined;
  },
): Promise<IssuedInvoice> {
  const org = requireOrg(request);
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
        return deliverCustomerInvoice(tx, request, invoice, opts, org);
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
      if (
        !mine ||
        !theirs ||
        !mine.scopes.includes('invoices') ||
        !theirs.scopes.includes('invoices')
      ) {
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
        reason: opts.message ?? null,
      });
      await auditRequest(request, tx, {
        orgId: invoice.recipientOrgId,
        action: 'bill.received',
        resourceType: 'network_bill',
        resourceId: bill.id,
        after: { number: bill.number, totalMinor: bill.totalMinor, currency: bill.currency },
      });
      // Email copy from the issuer's own Gmail / Outlook, sent by the worker after this commits.
      const emailTo = opts.recipientEmail ?? invoice.recipientEmail;
      if (emailTo) {
        await queueInvoiceEmail(tx, request, updated, {
          recipientEmail: emailTo,
          via: opts.sendVia ?? invoice.emailVia ?? null,
          senderUserId: org.userId,
        });
      }
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
}

const invoicesModule: FastifyPluginAsyncZod = async (app) => {
  // "Improve with AI" on the invoice editor: rewrites a line item description or the notes so
  // they read clearly to a customer. Uses the server's Anthropic key (same as roof damage photos).
  app.post(
    '/invoices/improve-text',
    {
      config: { permission: 'invoice:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary: 'Rewrite invoice line or notes text clearly with AI',
        body: z.object({
          text: z.string().trim().min(1).max(5000),
          kind: z.enum(['line', 'notes']),
          context: z.string().trim().max(500).optional(),
        }),
        response: { 200: z.object({ text: z.string() }) },
      },
    },
    async (request) => {
      requireOrg(request);
      const { anthropicApiKey, model } = request.server.config.roofDamage;
      if (!anthropicApiKey) {
        throw problem(
          'dependency_unavailable',
          'AI writing help is not set up on this server yet (no Anthropic API key).',
          { retryable: false },
        );
      }
      const { text, kind, context } = request.body;
      const system =
        kind === 'line'
          ? 'You rewrite one invoice line item description for a construction contractor (roofing, concrete, curb cutting, lawn, plumbing). Keep every fact, quantity, size and material the user gave. Do not invent work, prices, warranties or dates. Write plain, professional text a homeowner understands, at most 3 short sentences. Reply with the rewritten text only.'
          : 'You rewrite the notes section of a construction contractor invoice. Keep every fact and term the user gave. Do not invent prices, warranties, dates or legal terms. Write plain, polite, professional text, at most 6 short sentences. Reply with the rewritten text only.';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 600,
            system,
            messages: [
              {
                role: 'user',
                content: context ? `Item: ${context}\n\nText to improve:\n${text}` : text,
              },
            ],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
        const out = body.content?.find((b) => b.type === 'text')?.text?.trim();
        if (!out) throw new Error('empty reply');
        return { text: out.slice(0, 5000) };
      } catch (err) {
        request.log.warn({ err: (err as Error).message }, 'invoice improve-text failed');
        throw problem(
          'dependency_unavailable',
          'AI writing help is not available right now. Try again.',
          {
            retryable: true,
          },
        );
      } finally {
        clearTimeout(timer);
      }
    },
  );
  app.post(
    '/invoices',
    {
      config: { permission: 'invoice:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
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
      const totals = invoiceTotalsWithDiscount(body.lines, body.taxRate, body.discount);
      // Sending automatically issues the invoice, so refuse up front (before anything is created)
      // when this member could not press "Send invoice" themselves.
      if (body.autoSend) assertCan(request, 'invoice:issue');

      // Extra document blocks (From, Bill To, title, terms, discount) live in the free-form
      // billing_address column, so no migration is needed.
      const documentDetails = {
        from: body.from ?? null,
        billTo: body.billTo ?? null,
        title: body.title ?? null,
        terms: body.terms ?? null,
        discount: body.discount ?? null,
        discountMinor: totals.discountMinor,
      };

      const created = await tenantTx(request, async (tx) => {
        const [ownCompany] = await tx
          .select({ currency: organizations.currency })
          .from(organizations)
          .where(eq(organizations.id, org.orgId))
          .limit(1);
        if (!ownCompany) throw problem('not_found');

        if (body.billTo) {
          // An ordinary customer who is not on Field Pro.
          const number = await nextInvoiceNumber(tx, org.orgId);
          const recipientEmail = body.recipientEmail ?? body.billTo.email ?? null;
          const [invoice] = await tx
            .insert(invoices)
            .values({
              orgId: org.orgId,
              number,
              kind: 'standalone',
              status: 'draft',
              deliveryStatus: 'draft',
              recipientOrgId: null,
              recipientName: body.billTo.name,
              currency: ownCompany.currency,
              subtotalMinor: totals.subtotalMinor,
              taxMinor: totals.taxMinor,
              totalMinor: totals.totalMinor,
              issuedOn: body.issuedOn ?? null,
              dueOn: body.dueOn,
              memo: body.memo ?? null,
              billingAddress: documentDetails,
              recipientEmail,
              emailVia: body.sendVia ?? null,
              emailSenderUserId: recipientEmail ? org.userId : null,
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
          const dto = issuedInvoiceDto(invoice, insertedLines, null);
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'invoice.created',
            resourceType: 'invoice',
            resourceId: invoice.id,
            after: dto,
          });
          return dto;
        }

        const recipientOrgId = body.recipientOrgId!;
        // The recipient must be a company we have an active, invoice-scoped connection with.
        const [connection] = await tx
          .select()
          .from(companyConnections)
          .where(
            and(
              eq(companyConnections.orgId, org.orgId),
              eq(companyConnections.partnerOrgId, recipientOrgId),
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
        let projectName: string | null = null;
        if (body.projectId) {
          const [project] = await tx
            .select({ id: networkProjects.id, name: networkProjects.name })
            .from(networkProjects)
            .where(
              and(
                eq(networkProjects.orgId, org.orgId),
                eq(networkProjects.id, body.projectId),
                eq(networkProjects.partnerOrgId, recipientOrgId),
              ),
            )
            .limit(1);
          if (!project)
            throw problem('not_found', 'That shared project was not found for this company.');
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
            recipientOrgId,
            recipientName: connection.partnerDisplayName,
            issuedOn: body.issuedOn ?? null,
            billingAddress: documentDetails,
            networkProjectId: body.projectId ?? null,
            currency: ownCompany.currency,
            subtotalMinor: totals.subtotalMinor,
            taxMinor: totals.taxMinor,
            totalMinor: totals.totalMinor,
            dueOn: body.dueOn,
            memo: body.memo ?? null,
            recipientEmail: body.recipientEmail ?? null,
            emailVia: body.sendVia ?? null,
            emailSenderUserId: body.recipientEmail ? org.userId : null,
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
      if (!body.autoSend) return created;
      try {
        return await deliverInvoice(request, created.id, {});
      } catch (error) {
        // The draft is saved either way. A connection that changed between the two steps leaves it
        // as a draft; the Billing screen shows it with its "Send invoice" button.
        request.log.warn(
          { invoiceId: created.id, err: (error as Error).message },
          'auto-send skipped',
        );
        return created;
      }
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
      config: { permission: 'invoice:issue', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary: 'Issue the invoice and deliver it to the connected company',
        params: z.object({ invoiceId: UuidSchema }),
        body: SendInvoiceRequestSchema,
        response: { 200: IssuedInvoiceSchema },
      },
    },
    async (request) =>
      deliverInvoice(request, request.params.invoiceId, {
        message: request.body.message,
        recipientEmail: request.body.recipientEmail,
        sendVia: request.body.sendVia,
      }),
  );

  /**
   * Email an issued invoice (PDF attached) from the member's connected Gmail or Outlook: the first
   * time for an invoice issued without an address, or again after a failure. A message whose
   * outcome is unknown may already be in the recipient's inbox; the screen says so before this.
   */
  app.post(
    '/invoices/:invoiceId/email',
    {
      config: { permission: 'invoice:issue', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary: 'Email the invoice from your connected Gmail or Outlook (queued for the worker)',
        params: z.object({ invoiceId: UuidSchema }),
        body: EmailInvoiceRequestSchema,
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
        if (invoice.status === 'draft' || invoice.status === 'void') {
          throw problem(
            'invalid_transition',
            invoice.status === 'draft'
              ? 'Send the invoice first; its email goes out when it is issued.'
              : 'A void invoice cannot be emailed.',
          );
        }
        if (invoice.emailStatus === 'queued') {
          throw problem('conflict', 'This invoice email is already waiting to be sent.');
        }
        const recipientEmail = request.body.recipientEmail ?? invoice.recipientEmail;
        if (!recipientEmail) {
          throw problem('bad_request', 'Enter the email address to send this invoice to.');
        }
        await queueInvoiceEmail(tx, request, invoice, {
          recipientEmail,
          via: request.body.sendVia ?? invoice.emailVia ?? null,
          senderUserId: org.userId,
        });
        const dto = await loadIssuedInvoice(tx, org.orgId, invoice.id);
        if (!dto) throw problem('internal');
        return dto;
      });
    },
  );

  /**
   * Void a draft that was never delivered. A delivered invoice is corrected by a credit note, so
   * this route deliberately refuses once the recipient holds a bill.
   */
  app.post(
    '/invoices/:invoiceId/void',
    {
      config: { permission: 'invoice:void', rateLimit: { max: 30, timeWindow: '1 minute' } },
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
