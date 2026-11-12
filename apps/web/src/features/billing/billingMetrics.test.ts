import { describe, expect, it } from 'vitest';
import type { Bill, IssuedInvoice } from '@fieldline/contracts';
import { billingMetrics } from './billingMetrics';
const inv = (status: IssuedInvoice['deliveryStatus'], totalMinor: number, amountPaidMinor = 0) =>
  ({ deliveryStatus: status, currency: 'USD', totalMinor, amountPaidMinor }) as IssuedInvoice;
const bill = (status: Bill['status'], totalMinor: number) =>
  ({ status, currency: 'USD', totalMinor }) as Bill;
describe('master invoice totals', () => {
  it('never conflates drafts, receivables, received payables or paid invoices', () => {
    const [m] = billingMetrics(
      [inv('draft', 50000), inv('sent', 20000, 5000), inv('paid', 11000, 11000), inv('void', 9999)],
      [bill('received', 13000), bill('paid', 7000), bill('void', 50000)],
    );
    expect(m).toMatchObject({
      draftMinor: 50000, sentMinor: 31000, receivableMinor: 15000,
      paidReceivableMinor: 16000, receivedMinor: 20000,
      payableMinor: 13000, paidPayableMinor: 7000, sentCount: 2, receivedCount: 2,
    });
  });
  it('keeps different currencies separated', () => {
    const euros = { ...inv('sent', 200), currency: 'EUR' } as IssuedInvoice;
    expect(billingMetrics([inv('sent', 100), euros], []).map((x) => x.currency))
      .toEqual(['EUR', 'USD']);
  });
});
