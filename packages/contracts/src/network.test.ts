// COS-07/COS-08 contracts: the exchange lifecycle, the recipient's allowed actions and the money
// maths that both companies must agree on. These run without a database.
import { describe, expect, it } from 'vitest';
import {
  CreateNetworkInvoiceRequestSchema,
  DisputeBillRequestSchema,
  invoiceTotals,
  lineAmountMinor,
  networkInvoiceMachine,
  nextBillActions,
} from './network';

describe('network invoice lifecycle', () => {
  it('COS-07-STATE: follows draft -> sent -> approved -> paid', () => {
    expect(networkInvoiceMachine.initial).toBe('draft');
    expect(networkInvoiceMachine.canTransition('draft', 'sent')).toBe(true);
    expect(networkInvoiceMachine.canTransition('sent', 'approved')).toBe(true);
    expect(networkInvoiceMachine.canTransition('approved', 'paid')).toBe(true);
  });

  it('COS-07-STATE: a draft cannot be paid and a paid invoice is terminal', () => {
    expect(networkInvoiceMachine.canTransition('draft', 'paid')).toBe(false);
    expect(networkInvoiceMachine.isTerminal('paid')).toBe(true);
    expect(networkInvoiceMachine.nextStates('paid')).toEqual([]);
  });

  it('COS-08-STATE: a dispute can only be resolved or voided, never jump to paid', () => {
    expect(networkInvoiceMachine.nextStates('disputed')).toEqual(['resolved', 'void']);
    expect(networkInvoiceMachine.canTransition('disputed', 'paid')).toBe(false);
  });
});

describe('recipient bill actions', () => {
  it('COS-08-ACTION: received bills can be approved or disputed', () => {
    expect(nextBillActions('received')).toEqual(['approve', 'dispute']);
  });

  it('COS-09-ACTION: only an approved bill can be paid', () => {
    expect(nextBillActions('approved')).toContain('pay');
    expect(nextBillActions('received')).not.toContain('pay');
    expect(nextBillActions('disputed')).toEqual([]);
    expect(nextBillActions('paid')).toEqual([]);
    expect(nextBillActions('void')).toEqual([]);
  });
});

describe('invoice money', () => {
  it('COS-07-MONEY: rounds a decimal quantity once, at the line', () => {
    // 2.5 hours at $80.00 = $200.00
    expect(lineAmountMinor('2.5', 8000)).toBe(20_000);
    // 0.333 roofing squares at $1.00 rounds half-up to 33 cents
    expect(lineAmountMinor('0.333', 100)).toBe(33);
  });

  it('COS-07-MONEY: rejects a zero quantity and a negative price', () => {
    expect(() => lineAmountMinor('0', 100)).toThrow();
    expect(() => lineAmountMinor('1', -1)).toThrow();
  });

  it('COS-07-MONEY: taxes the subtotal once and never drifts by a cent', () => {
    const totals = invoiceTotals(
      [
        { quantity: '1', unitPriceMinor: 100_000 },
        { quantity: '1', unitPriceMinor: 25_000 },
      ],
      '0.0825',
    );
    expect(totals.subtotalMinor).toBe(125_000);
    expect(totals.taxMinor).toBe(10_313); // 10312.5 rounds half-up
    expect(totals.totalMinor).toBe(135_313);
    expect(totals.totalMinor).toBe(totals.subtotalMinor + totals.taxMinor);
  });
});

describe('request validation', () => {
  const valid = {
    recipientOrgId: '2b0f1a3c-1111-4a2b-9c3d-4e5f60718293',
    dueOn: '2026-12-01',
    lines: [{ description: 'Tear-off and re-roof', quantity: '1', unitPriceMinor: 125_000 }],
  };

  it('COS-07-VALID: accepts the launch-proof invoice shape and defaults the tax rate', () => {
    const parsed = CreateNetworkInvoiceRequestSchema.parse(valid);
    expect(parsed.taxRate).toBe('0');
    expect(parsed.lines).toHaveLength(1);
  });

  it('COS-07-VALID: refuses an invoice with no lines', () => {
    const result = CreateNetworkInvoiceRequestSchema.safeParse({ ...valid, lines: [] });
    expect(result.success).toBe(false);
  });

  it('COS-08-VALID: a dispute must explain what is wrong', () => {
    expect(DisputeBillRequestSchema.safeParse({ reason: 'wrong' }).success).toBe(false);
    expect(
      DisputeBillRequestSchema.safeParse({ reason: 'Line 2 duplicates the deposit invoice.' }).success,
    ).toBe(true);
  });
});
