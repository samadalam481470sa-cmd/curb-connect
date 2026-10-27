// Feature flags (PLT-020, STR non-negotiable "unfinished features are visibly unavailable"):
// evaluated on the server per tenant and, where meaningful, per jurisdiction. RLS lets a tenant
// read global rows (org_id NULL) and its own rows only.
import {
  FEATURE_FLAG_KEYS,
  type FeatureFlagKey,
  type FlagOverride,
  isFeatureFlagKey,
  resolveFlag,
} from '@fieldline/contracts';
import type { Tx } from '../db/runtime';
import { featureFlags } from '../db/schema';

export type FlagMap = Record<FeatureFlagKey, boolean>;

export async function loadFlagOverrides(tx: Tx): Promise<FlagOverride[]> {
  const rows = await tx
    .select({
      key: featureFlags.key,
      enabled: featureFlags.enabled,
      orgId: featureFlags.orgId,
      jurisdictionId: featureFlags.jurisdictionId,
    })
    .from(featureFlags);
  return rows.flatMap((row) =>
    isFeatureFlagKey(row.key) ? [{ key: row.key, enabled: row.enabled, orgId: row.orgId, jurisdictionId: row.jurisdictionId }] : [],
  );
}

export function evaluateFlags(
  overrides: readonly FlagOverride[],
  ctx: { orgId?: string; jurisdictionId?: string },
): FlagMap {
  return Object.fromEntries(FEATURE_FLAG_KEYS.map((key) => [key, resolveFlag(key, overrides, ctx)])) as FlagMap;
}

/** Evaluates every flag for the org (and optional jurisdiction) visible to this transaction. */
export async function flagsFor(tx: Tx, orgId: string | null, jurisdictionId?: string): Promise<FlagMap> {
  const overrides = orgId ? await loadFlagOverrides(tx) : (await loadFlagOverrides(tx)).filter((o) => !o.orgId);
  return evaluateFlags(overrides, {
    ...(orgId && { orgId }),
    ...(jurisdictionId && { jurisdictionId }),
  });
}

export async function isEnabled(tx: Tx, orgId: string, key: FeatureFlagKey, jurisdictionId?: string): Promise<boolean> {
  return (await flagsFor(tx, orgId, jurisdictionId))[key];
}
