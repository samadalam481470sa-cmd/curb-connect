// Canonical hashing for the control compliance audit packet. Recipients recompute the digest after
// removing `integrity`; sorting object keys recursively makes that recomputation independent of
// JSON key order.
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
  });
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Digest recorded in `integrity.digest` over the packet payload without that field. */
export function controlPacketDigest(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}
