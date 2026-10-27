// Feature flag keys (PLT-020). Flags are evaluated per organization and, where noted, per
// jurisdiction (feature_flags table: org_id nullable = global default, jurisdiction_id nullable).
// A flag that is off shows the feature as unavailable; it never shows fake data.
import { z } from 'zod';

export interface FeatureFlagDefinition {
  description: string;
  /** Default when no row exists. */
  defaultEnabled: boolean;
  /** Whether a jurisdiction-scoped override is meaningful for this flag. */
  jurisdictionScoped: boolean;
}

export const FEATURE_FLAGS = {
  'roof.orders': {
    description: 'Roof measurement orders and reports.',
    defaultEnabled: true,
    jurisdictionScoped: false,
  },
  'roof.diy_canvas': {
    description: 'Self-service roof tracing canvas (DIY mode).',
    defaultEnabled: true,
    jurisdictionScoped: false,
  },
  'roof.assisted_review': {
    description: 'Human-assisted roof measurement with review queue.',
    defaultEnabled: true,
    jurisdictionScoped: false,
  },
  'roof.auto_facets': {
    description: 'Machine facet detection suggestions (shadow until validated).',
    defaultEnabled: false,
    jurisdictionScoped: false,
  },
  'roof.esx_export': {
    description: 'Insurance estimating export (unsupported until a licensed adapter exists).',
    defaultEnabled: false,
    jurisdictionScoped: false,
  },
  'curb.projects': {
    description: 'Curb cutting projects and estimates.',
    defaultEnabled: true,
    jurisdictionScoped: false,
  },
  'curb.guided_capture': {
    description: 'Guided phone photo capture for curb intake.',
    defaultEnabled: true,
    jurisdictionScoped: false,
  },
  'curb.ai_measurement': {
    description: 'Machine curb detection and measurement suggestions.',
    defaultEnabled: false,
    jurisdictionScoped: true,
  },
  'curb.permit_rules': {
    description: 'Jurisdiction permit rule evaluation.',
    defaultEnabled: false,
    jurisdictionScoped: true,
  },
  'crm.leads': { description: 'Leads inbox.', defaultEnabled: true, jurisdictionScoped: false },
  'crm.jobs': { description: 'Jobs pipeline.', defaultEnabled: true, jurisdictionScoped: false },
  proposals: { description: 'Proposals and e-signature.', defaultEnabled: true, jurisdictionScoped: false },
  'billing.invoices': {
    description: 'Invoices and payments.',
    defaultEnabled: true,
    jurisdictionScoped: false,
  },
  'billing.online_payments': {
    description: 'Card/bank payments through the payment adapter.',
    defaultEnabled: false,
    jurisdictionScoped: false,
  },
  'portal.homeowner': {
    description: 'Homeowner portal links.',
    defaultEnabled: true,
    jurisdictionScoped: false,
  },
  'ops.supplier_orders': {
    description: 'Supplier material orders.',
    defaultEnabled: false,
    jurisdictionScoped: false,
  },
  'ops.dispatch': { description: 'Crew scheduling and dispatch.', defaultEnabled: true, jurisdictionScoped: false },
  'notifications.sms': {
    description: 'SMS notifications (requires consent).',
    defaultEnabled: false,
    jurisdictionScoped: false,
  },
} as const satisfies Record<string, FeatureFlagDefinition>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];
export const FeatureFlagKeySchema = z.enum(FEATURE_FLAG_KEYS as [FeatureFlagKey, ...FeatureFlagKey[]]);

export function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return Object.hasOwn(FEATURE_FLAGS, value);
}

export interface FlagOverride {
  key: FeatureFlagKey;
  enabled: boolean;
  orgId?: string | null;
  jurisdictionId?: string | null;
}

/**
 * Resolves a flag: the most specific override wins (org + jurisdiction > org > jurisdiction >
 * global > definition default).
 */
export function resolveFlag(
  key: FeatureFlagKey,
  overrides: readonly FlagOverride[],
  ctx: { orgId?: string; jurisdictionId?: string } = {},
): boolean {
  const score = (o: FlagOverride): number => {
    if (o.key !== key) return -1;
    if (o.orgId && o.orgId !== ctx.orgId) return -1;
    if (o.jurisdictionId && o.jurisdictionId !== ctx.jurisdictionId) return -1;
    return (o.orgId ? 2 : 0) + (o.jurisdictionId ? 1 : 0);
  };
  let best: FlagOverride | undefined;
  let bestScore = -1;
  for (const o of overrides) {
    const s = score(o);
    if (s > bestScore) {
      best = o;
      bestScore = s;
    }
  }
  return best ? best.enabled : FEATURE_FLAGS[key].defaultEnabled;
}
