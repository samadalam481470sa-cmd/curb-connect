// COS-08/COS-09: the API and the web app must agree about what a bill allows. These assertions
// pin the shared helpers the routes use, without a database.
import { billStatusEnum } from '../../db/schema/_enums';
import { BILL_STATUSES, nextBillActions, networkInvoiceMachine } from '@fieldline/contracts';
import { describe, expect, it } from 'vitest';

describe('bill rules', () => {
  it('COS-08-RULE: every stored bill status is a contract status', () => {
    expect([...BILL_STATUSES]).toEqual([...billStatusEnum.enumValues]);
  });

  it('COS-09-RULE: a paid bill never offers further actions', () => {
    for (const status of ['paid', 'void'] as const) {
      expect(nextBillActions(status)).toEqual([]);
    }
  });

  it('COS-09-RULE: settlement is only reachable from an approved bill', () => {
    const payable = BILL_STATUSES.filter((status) => nextBillActions(status).includes('pay'));
    expect(payable).toEqual(['approved']);
    expect(networkInvoiceMachine.canTransition('approved', 'paid')).toBe(true);
  });
});
