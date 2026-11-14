import { describe, expect, it } from 'vitest';
import { withLegalFooter } from './mail';

describe('withLegalFooter', () => {
  const message = { to: 'a@example.com', subject: 'Hi', text: 'Body\n\n', idempotencyKey: 'k' };

  it('adds sender, postal address, reason and a stop link', () => {
    const out = withLegalFooter(message, {
      appOrigin: 'https://app.example.com/',
      postalAddress: 'PO Box 1, Dallas, TX 75201',
    });
    expect(out.text).toContain('Body\n\n--\nSent by Field Pro');
    expect(out.text).toContain('PO Box 1, Dallas, TX 75201');
    expect(out.text).toContain('https://app.example.com/settings/notifications');
    expect(out.subject).toBe('Hi');
  });

  it('omits the address line when none is configured', () => {
    const out = withLegalFooter(message, {
      appOrigin: 'https://app.example.com',
      postalAddress: undefined,
    });
    expect(out.text).not.toContain('undefined');
  });
});
