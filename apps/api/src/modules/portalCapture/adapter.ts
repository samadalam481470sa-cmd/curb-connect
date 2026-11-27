// Portal adapter interface + registry for Renditions-style external-order
// capture.
//
// HARD RULE — no anti-bot evasion, ever: adapters log in with the supplier's
// OWN credentials (provided by the supplier, sealed in the vault) using a
// plain authorized login to read the supplier's OWN orders. No CAPTCHA
// solving, no fingerprint spoofing, no stealth/undetectable-browser tricks,
// no proxy rotation to defeat blocks. If a portal blocks automated login,
// the connection state is honestly 'blocked' and capture stops there.
//
// ZERO live adapters ship with this framework. No real builder portal has
// been verified, and inventing one would be fake. An adapter is added per
// builder portal, written and tested against a real supplier-authorized
// account, then registered in PORTAL_ADAPTERS below. Until then every
// capture run honestly reports 'no_adapters'.
import type { PortalConnectionStatus } from '../../db/schema/portalCapture';

export interface PortalCredentials {
  loginIdentifier: string;
  secret: string;
}

export interface PortalOrderSummary {
  builderPoNumber: string;
  builderName: string;
  /** ISO date (YYYY-MM-DD) when the portal publishes one. */
  orderedOn?: string | null;
}

export interface PortalOrderLine {
  /** Builder's item/package name exactly as captured. */
  label: string;
  quantity: number;
  unit: string;
  /** Integer minor units when the portal publishes a price; null otherwise. */
  unitPriceMinor: number | null;
}

export interface PortalOrderDetail extends PortalOrderSummary {
  lines: PortalOrderLine[];
  /** Raw captured payload, stored verbatim as the audit trail. */
  raw: unknown;
}

export type PortalLoginResult =
  | { ok: true; session: unknown }
  | {
      ok: false;
      /** Honest failure state: bad credentials, changed portal, or blocked. */
      state: Extract<PortalConnectionStatus, 'login_failed' | 'portal_changed' | 'blocked'>;
      error: string;
    };

export interface PortalAdapter {
  portalKey: string;
  portalName: string;
  /**
   * Plain authorized login with the supplier's own credentials. Must return
   * a 'blocked' result (never evade) when the portal refuses automated
   * access, and 'portal_changed' when the login flow no longer matches.
   */
  login(credentials: PortalCredentials): Promise<PortalLoginResult>;
  listOrders(session: unknown): Promise<PortalOrderSummary[]>;
  fetchOrder(session: unknown, builderPoNumber: string): Promise<PortalOrderDetail>;
}

/**
 * Live adapter registry, keyed by portalKey. INTENTIONALLY EMPTY: no real
 * builder portal has been verified yet. Add an adapter here only after it
 * has been written and tested against a real supplier-authorized account on
 * that portal. The fixture adapter (fixtureAdapter.ts) is for tests only and
 * must never be registered here.
 */
export const PORTAL_ADAPTERS: ReadonlyMap<string, PortalAdapter> = new Map();

export function registeredAdapters(
  registry: ReadonlyMap<string, PortalAdapter> = PORTAL_ADAPTERS,
): { portalKey: string; portalName: string }[] {
  return [...registry.values()].map((a) => ({ portalKey: a.portalKey, portalName: a.portalName }));
}
