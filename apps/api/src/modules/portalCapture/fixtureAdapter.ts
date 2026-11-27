// TEST-ONLY fixture adapter. Simulates a builder portal with canned orders
// so the capture engine (login states, normalization, dedupe/revision, run
// lifecycle) can be unit-tested without any real portal. It is NEVER
// registered in PORTAL_ADAPTERS and must never be wired into production:
// no real portal has been verified, and pretending otherwise would be fake.
import type { PortalAdapter, PortalOrderDetail } from './adapter';

export interface FixturePortalOptions {
  portalKey?: string;
  portalName?: string;
  /** Login succeeds only with this secret; anything else is login_failed. */
  acceptedSecret?: string;
  /** When set, login always returns this failure state (e.g. 'blocked'). */
  loginFailure?: 'login_failed' | 'portal_changed' | 'blocked';
  orders?: PortalOrderDetail[];
  /** PO numbers whose fetchOrder throws (per-order error path). */
  failingPoNumbers?: string[];
}

export function fixturePortalAdapter(options: FixturePortalOptions = {}): PortalAdapter {
  const orders = options.orders ?? [];
  const acceptedSecret = options.acceptedSecret ?? 'fixture-secret';
  const failing = new Set(options.failingPoNumbers ?? []);
  return {
    portalKey: options.portalKey ?? 'fixture-portal',
    portalName: options.portalName ?? 'Fixture Builder Portal (tests only)',
    async login(credentials) {
      if (options.loginFailure) {
        return {
          ok: false,
          state: options.loginFailure,
          error: `Fixture portal simulated a ${options.loginFailure} login result.`,
        };
      }
      if (credentials.secret !== acceptedSecret) {
        return { ok: false, state: 'login_failed', error: 'Fixture portal rejected the secret.' };
      }
      return { ok: true, session: { fixture: true } };
    },
    async listOrders() {
      return orders.map((o) => ({
        builderPoNumber: o.builderPoNumber,
        builderName: o.builderName,
        orderedOn: o.orderedOn ?? null,
      }));
    },
    async fetchOrder(_session, builderPoNumber) {
      if (failing.has(builderPoNumber)) {
        throw new Error(`Fixture portal failed to load order ${builderPoNumber}.`);
      }
      const found = orders.find((o) => o.builderPoNumber === builderPoNumber);
      if (!found) throw new Error(`Fixture portal has no order ${builderPoNumber}.`);
      return found;
    },
  };
}
