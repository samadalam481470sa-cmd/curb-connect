import { describe, expect, it } from 'vitest';
import { canTransitionChangeOrder, changeOrderDocumentHash, typedSignatureMatches } from './attestation';

describe('change order attestation', () => {
  it('hashes the exact terms and changes when terms change', () => {
    const base = { number: 'CO-1', title: 'Extra work', reason: 'Hidden damage', amountDeltaMinor: 150000, currency: 'USD', scheduleImpactDays: 2, lines: [] };
    expect(changeOrderDocumentHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(changeOrderDocumentHash(base)).toBe(changeOrderDocumentHash({ ...base }));
    expect(changeOrderDocumentHash({ ...base, amountDeltaMinor: 150001 })).not.toBe(changeOrderDocumentHash(base));
  });
  it('typed signature must match the signer name', () => {
    expect(typedSignatureMatches('Jane Smith', '  jane   smith ')).toBe(true);
    expect(typedSignatureMatches('Jane Smith', 'John Smith')).toBe(false);
    expect(typedSignatureMatches('Jane Smith', '')).toBe(false);
  });
  it('flow cannot skip approval steps', () => {
    expect(canTransitionChangeOrder('draft', 'accepted')).toBe(false);
    expect(canTransitionChangeOrder('sent_to_customer', 'accepted')).toBe(true);
    expect(canTransitionChangeOrder('accepted', 'withdrawn')).toBe(false);
  });
});
