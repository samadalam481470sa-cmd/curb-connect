import { CreateNetworkInvoiceRequestSchema } from '@fieldline/contracts';
import { describe, expect, it } from 'vitest';
import {
  type DraftState,
  EMPTY_PARTY,
  addDays,
  draftProblems,
  draftRequest,
  draftTotals,
  draftDiscount,
  newLine,
} from './invoiceDraft';

function draft(overrides: Partial<DraftState> = {}): DraftState {
  return {
    title: 'Invoice',
    from: { ...EMPTY_PARTY, name: 'Acme Roofing', email: 'office@acme.example' },
    billTo: { ...EMPTY_PARTY, name: 'Jane Homeowner', email: 'jane@client.example' },
    issuedOn: '2026-11-20',
    terms: 'Net 30',
    lines: [
      {
        ...newLine('a'),
        description: 'Tear-off and reroof',
        details: '30 squares',
        rate: '350',
        qty: '30',
      },
      { ...newLine('b'), description: 'Drip edge', rate: '2.5', qty: '120' },
      newLine('c'),
    ],
    notes: 'Thanks for your business.',
    taxType: 'total',
    taxPercent: '8.25',
    payments: [],
    discountType: 'percent',
    discountValue: '10',
    ...overrides,
  };
}

describe('invoice draft', () => {
  it('totals lines, takes the discount off before tax', () => {
    const d = draft();
    const t = draftTotals(d.lines, d.taxPercent, draftDiscount(d.discountType, d.discountValue));
    expect(t.subtotalMinor).toBe(1_080_000); // 10,500 + 300
    expect(t.discountMinor).toBe(108_000);
    expect(t.taxMinor).toBe(80_190); // 8.25% of 9,720.00
    expect(t.totalMinor).toBe(1_052_190);
  });

  it('builds a valid API request for a customer and drops empty lines', () => {
    const req = draftRequest(draft(), { autoSend: true });
    const parsed = CreateNetworkInvoiceRequestSchema.parse(req);
    expect(parsed.billTo?.name).toBe('Jane Homeowner');
    expect(parsed.recipientEmail).toBe('jane@client.example');
    expect(parsed.dueOn).toBe('2026-12-20');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]?.description).toBe('Tear-off and reroof\n30 squares');
    expect(parsed.taxRate).toBe('0.0825');
    expect(parsed.autoSend).toBe(true);
  });

  it('explains what is missing', () => {
    const problems = draftProblems(draft({ billTo: { ...EMPTY_PARTY }, lines: [newLine('x')] }));
    expect(problems).toContain('Add the client name under Bill To.');
    expect(problems).toContain('Add at least one line item with a description.');
  });

  it('caps a flat discount at the subtotal', () => {
    const d = draft({ discountType: 'flat', discountValue: '999999', taxPercent: '' });
    const t = draftTotals(d.lines, d.taxPercent, draftDiscount(d.discountType, d.discountValue));
    expect(t.totalMinor).toBe(0);
  });

  it('sends a payment schedule that adds up to 100%, and flags one that does not', () => {
    const payments = [
      { key: 'p1', label: 'Deposit', dueOn: '2026-11-20', percent: '50' },
      { key: 'p2', label: 'Final', dueOn: '2026-12-20', percent: '50' },
    ];
    const req = CreateNetworkInvoiceRequestSchema.parse(
      draftRequest(draft({ payments }), { autoSend: false }),
    );
    expect(req.paymentSchedule).toHaveLength(2);
    expect(draftProblems(draft({ payments: [{ ...payments[0]!, percent: '40' }] }))).toContain(
      'Scheduled payments must add up to 100%.',
    );
  });

  it('charges no tax when the tax type is None', () => {
    const req = draftRequest(draft({ taxType: 'none' }), { autoSend: false });
    expect(req.taxRate).toBe('0');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-01-31', 30)).toBe('2026-03-02');
  });

  it('stores logo, signature and photos with the invoice when provided', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const req = CreateNetworkInvoiceRequestSchema.parse(
      draftRequest(draft(), {
        autoSend: false,
        attachments: { logo, photos: ['data:image/jpeg;base64,/9j/'] },
      }),
    );
    expect(req.attachments?.logo).toBe(logo);
    expect(req.attachments?.photos).toHaveLength(1);
    const bare = draftRequest(draft(), { autoSend: false });
    expect(bare.attachments).toBeUndefined();
    expect(
      CreateNetworkInvoiceRequestSchema.safeParse({
        ...bare,
        attachments: { logo: 'https://example.com/logo.png' },
      }).success,
    ).toBe(false);
  });

  it('rejects an invoice with both a company and a customer', () => {
    const req = {
      ...draftRequest(draft(), { autoSend: false }),
      recipientOrgId: '6f1c5d9e-2b7a-4c2e-9d1f-3a5b7c9e1f20',
    };
    expect(CreateNetworkInvoiceRequestSchema.safeParse(req).success).toBe(false);
  });
});
