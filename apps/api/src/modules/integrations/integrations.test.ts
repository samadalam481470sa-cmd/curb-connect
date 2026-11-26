// Gated-integration status tests: QuickBooks and the payments rail must report their
// honest not-connected states from env alone, naming what is missing, and never claim a
// connection that does not exist.
import { describe, expect, it } from 'vitest';
import { paymentsRailStatus, quickBooksStatus } from './index';

describe('quickBooksStatus', () => {
  it('is not_connected with the missing vars named when nothing is set', () => {
    const status = quickBooksStatus({});
    expect(status.state).toBe('not_connected');
    expect(status.missing).toContain('QUICKBOOKS_CLIENT_ID');
    expect(status.missing).toContain('QUICKBOOKS_CLIENT_SECRET');
    expect(status.message).toContain('nothing syncs');
  });

  it('is misconfigured (not connected) when credentials exist but no company signed in', () => {
    const status = quickBooksStatus({
      QUICKBOOKS_CLIENT_ID: 'id',
      QUICKBOOKS_CLIENT_SECRET: 'secret',
    });
    expect(status.state).toBe('misconfigured');
    expect(status.missing).toEqual([]);
  });

  it('treats blank env values as missing', () => {
    const status = quickBooksStatus({ QUICKBOOKS_CLIENT_ID: '  ', QUICKBOOKS_CLIENT_SECRET: '' });
    expect(status.state).toBe('not_connected');
    expect(status.missing).toHaveLength(2);
  });
});

describe('paymentsRailStatus', () => {
  it('is not_connected when no provider is chosen', () => {
    const status = paymentsRailStatus({});
    expect(status.state).toBe('not_connected');
    expect(status.provider).toBeNull();
    expect(status.missing).toEqual(['PAYMENTS_PROVIDER']);
    expect(status.lienWaiverGating).toBe(false);
    expect(status.earlyPayEnabled).toBe(false);
  });

  it('rejects an unsupported provider honestly', () => {
    const status = paymentsRailStatus({ PAYMENTS_PROVIDER: 'venmo' });
    expect(status.state).toBe('unsupported_provider');
    expect(status.message).toContain('No money moves');
  });

  it('names missing credentials for a supported provider', () => {
    const status = paymentsRailStatus({ PAYMENTS_PROVIDER: 'dwolla' });
    expect(status.state).toBe('not_connected');
    expect(status.missing).toEqual(['DWOLLA_KEY', 'DWOLLA_SECRET']);
  });

  it('reports connected only with credentials, and still warns money does not move yet', () => {
    const status = paymentsRailStatus({
      PAYMENTS_PROVIDER: 'stripe_connect',
      STRIPE_CONNECT_SECRET_KEY: 'sk_test_x',
      PAYMENTS_LIEN_WAIVER_GATING: 'true',
      PAYMENTS_EARLY_PAY_ENABLED: 'true',
    });
    expect(status.state).toBe('connected');
    expect(status.lienWaiverGating).toBe(true);
    expect(status.earlyPayEnabled).toBe(true);
    expect(status.message).toContain('before money moves');
  });
});
