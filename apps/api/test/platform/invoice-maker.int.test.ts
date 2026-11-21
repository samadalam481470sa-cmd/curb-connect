// The Invoice Dashboard against the real database through the restricted app role: invoices for
// ordinary customers, the Bill To client list, sending without a connected company, and importing
// invoices from another invoice app.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type TestContext, call, createCompany, createTestContext } from '../helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.cleanup();
});
afterAll(async () => {
  await ctx?.close();
});

const key = () => ({ 'idempotency-key': `inv-${crypto.randomUUID()}` });

const customerInvoice = {
  billTo: {
    name: 'Jane Homeowner',
    email: 'jane@client.example',
    street: '12 Elm St',
    cityState: 'Dallas, TX',
  },
  from: { name: 'Acme Roofing', phone: '(214) 555-0100' },
  title: 'Invoice',
  terms: 'Net 30',
  issuedOn: '2026-11-20',
  dueOn: '2026-12-20',
  taxRate: '0.0825',
  discount: { type: 'percent', value: '10' },
  paymentSchedule: [
    { label: 'Deposit', dueOn: '2026-11-20', percent: '50' },
    { label: 'Final', dueOn: '2026-12-20', percent: '50' },
  ],
  lines: [
    {
      description: 'Tear-off and reroof\n30 squares',
      quantity: '30',
      unit: 'each',
      unitPriceMinor: 35000,
    },
  ],
};

describe('Invoice Dashboard', () => {
  it('makes an invoice for an ordinary customer, keeps its details and saves the client', async () => {
    const company = await createCompany(ctx);
    const res = await call(ctx, 'POST', '/v1/invoices', {
      as: company.owner,
      body: customerInvoice,
      headers: key(),
    });
    expect(res.statusCode, res.body).toBe(201);
    const invoice = res.json();
    expect(invoice).toMatchObject({
      status: 'draft',
      recipientOrgId: null,
      recipientName: 'Jane Homeowner',
      subtotalMinor: 1_050_000,
      discountMinor: 105_000,
      taxMinor: 77_963,
      totalMinor: 1_022_963,
      terms: 'Net 30',
      billTo: { name: 'Jane Homeowner', cityState: 'Dallas, TX' },
      from: { name: 'Acme Roofing' },
    });
    expect(invoice.paymentSchedule).toHaveLength(2);

    const opened = await call(ctx, 'GET', `/v1/invoices/${invoice.id}`, { as: company.owner });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().billTo.street).toBe('12 Elm St');

    // The client shows up in the Bill To picker, found by part of the name.
    const clients = await call(ctx, 'GET', '/v1/invoice-clients?q=homeo', { as: company.owner });
    expect(clients.statusCode, clients.body).toBe(200);
    expect(clients.json().items).toEqual([
      expect.objectContaining({
        kind: 'customer',
        name: 'Jane Homeowner',
        party: expect.objectContaining({ email: 'jane@client.example' }),
      }),
    ]);

    // A second invoice to the same client (different letter case) reuses the client.
    const again = await call(ctx, 'POST', '/v1/invoices', {
      as: company.owner,
      body: { ...customerInvoice, billTo: { name: 'jane homeowner', phone: '(214) 555-0199' } },
      headers: key(),
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().number).not.toBe(invoice.number);
    const all = await call(ctx, 'GET', '/v1/invoice-clients', { as: company.owner });
    expect(all.json().items.filter((c: { kind: string }) => c.kind === 'customer')).toHaveLength(1);
  });

  it('sends a customer invoice without a connected company', async () => {
    const company = await createCompany(ctx);
    const created = await call(ctx, 'POST', '/v1/invoices', {
      as: company.owner,
      body: { ...customerInvoice, billTo: { name: 'No Email Client' } },
      headers: key(),
    });
    expect(created.statusCode).toBe(201);
    const sent = await call(ctx, 'POST', `/v1/invoices/${created.json().id}/send`, {
      as: company.owner,
      body: {},
      headers: key(),
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toMatchObject({ status: 'issued', deliveryStatus: 'sent' });
  });

  it('rejects a payment schedule that does not add up to 100%', async () => {
    const company = await createCompany(ctx);
    const res = await call(ctx, 'POST', '/v1/invoices', {
      as: company.owner,
      body: {
        ...customerInvoice,
        paymentSchedule: [{ label: 'Deposit', dueOn: '2026-11-20', percent: '40' }],
      },
      headers: key(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('imports invoices from another app, skips repeats and keeps the new-invoice numbering working', async () => {
    const company = await createCompany(ctx);
    const year = new Date().getFullYear();
    const body = {
      source: 'Invoice Simple',
      invoices: [
        {
          number: 'INV0001',
          clientName: 'Bob Builder',
          clientEmail: 'bob@client.example',
          issuedOn: '2026-10-01',
          status: 'paid',
          totalMinor: 40000,
          taxMinor: 0,
          amountPaidMinor: 0,
          lines: [],
        },
        {
          number: `INV-${year}-0003`,
          clientName: 'Carla Concrete',
          status: 'partially_paid',
          totalMinor: 100000,
          taxMinor: 8000,
          amountPaidMinor: 25000,
          lines: [{ description: 'Curb cut', quantity: '2', unitPriceMinor: 46000 }],
        },
      ],
    };
    const first = await call(ctx, 'POST', '/v1/invoices/import', {
      as: company.owner,
      body,
      headers: key(),
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ imported: 2, skipped: [] });

    const second = await call(ctx, 'POST', '/v1/invoices/import', {
      as: company.owner,
      body,
      headers: key(),
    });
    expect(second.json().imported).toBe(0);
    expect(second.json().skipped).toHaveLength(2);

    const list = await call(ctx, 'GET', '/v1/invoices?limit=50', { as: company.owner });
    const items = list.json().items as {
      number: string;
      status: string;
      amountPaidMinor: number;
      totalMinor: number;
    }[];
    expect(items.find((i) => i.number === 'INV0001')).toMatchObject({
      status: 'paid',
      amountPaidMinor: 40000,
    });
    expect(items.find((i) => i.number === `INV-${year}-0003`)).toMatchObject({
      status: 'partially_paid',
      amountPaidMinor: 25000,
    });

    // Imported clients are in the Bill To list too.
    const clients = await call(ctx, 'GET', '/v1/invoice-clients', { as: company.owner });
    expect(
      clients
        .json()
        .items.map((c: { name: string }) => c.name)
        .sort(),
    ).toEqual(['Bob Builder', 'Carla Concrete']);

    // The next own invoice is numbered INV-<year>-0003 by count but must step past the imported one.
    const created = await call(ctx, 'POST', '/v1/invoices', {
      as: company.owner,
      body: customerInvoice,
      headers: key(),
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().number).toBe(`INV-${year}-0004`);
  });
});
