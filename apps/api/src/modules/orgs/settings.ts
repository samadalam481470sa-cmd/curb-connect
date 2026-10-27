// PLT-014: tenant defaults as typed sections, stored as immutable org_settings_revisions. Prior
// approved documents reference the revision number they used, so a later change never alters them.
import { FractionStringSchema, type Action, ProductLineSchema } from '@fieldline/contracts';
import { z } from 'zod';

const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const SETTINGS_SECTIONS = {
  general: z
    .object({
      tradeFocus: z.array(ProductLineSchema).min(1),
      workRegions: z.array(z.string().min(1).max(120)).max(50),
      logoMediaAssetId: z.uuid().nullable(),
      supportEmail: z.email().max(320).nullable(),
    })
    .partial()
    .strict(),
  estimating: z
    .object({
      pricingMode: z.enum(['markup', 'target_margin']),
      defaultOverheadRate: FractionStringSchema,
      defaultContingencyRate: FractionStringSchema,
      defaultTargetMargin: FractionStringSchema,
      defaultMarkupRate: z.string().regex(/^(0|[1-9]\d{0,2})(\.\d{1,6})?$/),
      roofWastePolicy: z.enum(['per_facet', 'whole_roof']),
    })
    .partial()
    .strict(),
  /** "Company payment settings" (PLT-015 G): owner, admin, finance only. */
  billing: z
    .object({
      taxRate: FractionStringSchema.nullable(),
      taxLabel: z.string().max(60).nullable(),
      paymentTermsDays: z.number().int().min(0).max(365),
      depositRate: FractionStringSchema.nullable(),
      acceptedPaymentMethods: z.array(z.enum(['card', 'ach', 'check', 'cash', 'financing'])).max(5),
      remitTo: z.string().max(500).nullable(),
    })
    .partial()
    .strict(),
  notifications: z
    .object({
      quietHours: z.object({ start: Hhmm, end: Hhmm }).nullable(),
      replyToEmail: z.email().max(320).nullable(),
    })
    .partial()
    .strict(),
  /** PLT-014 S: setup resumes from the last confirmed step. */
  onboarding: z
    .object({
      completedSteps: z.array(z.enum(['company', 'products', 'regions', 'pricing', 'team', 'sample_estimate'])),
      currentStep: z.enum(['company', 'products', 'regions', 'pricing', 'team', 'sample_estimate', 'done']),
    })
    .partial()
    .strict(),
} as const;

export type SettingsSection = keyof typeof SETTINGS_SECTIONS;
export const SETTINGS_SECTION_KEYS = Object.keys(SETTINGS_SECTIONS) as SettingsSection[];
export const SettingsSectionSchema = z.enum(SETTINGS_SECTION_KEYS as [SettingsSection, ...SettingsSection[]]);

export const SECTION_WRITE_PERMISSION: Record<SettingsSection, Action> = {
  general: 'org:settings_update',
  estimating: 'org:settings_update',
  billing: 'billing_settings:update',
  notifications: 'org:settings_update',
  onboarding: 'org:settings_update',
};

export const SECTION_READ_PERMISSION: Partial<Record<SettingsSection, Action>> = {
  billing: 'billing_settings:read',
};

export type OrgSettings = { [K in SettingsSection]: z.infer<(typeof SETTINGS_SECTIONS)[K]> };

/** First-run defaults (PLT-014). Rates are fractions; tax is unset until the company decides. */
export function defaultSettings(productLines: readonly ('roof' | 'curb')[]): OrgSettings {
  return {
    general: { tradeFocus: [...productLines], workRegions: [], logoMediaAssetId: null, supportEmail: null },
    estimating: {
      pricingMode: 'target_margin',
      defaultOverheadRate: '0.10',
      defaultContingencyRate: '0',
      defaultTargetMargin: '0.25',
      roofWastePolicy: 'per_facet',
    },
    billing: {
      taxRate: null,
      taxLabel: null,
      paymentTermsDays: 30,
      depositRate: null,
      acceptedPaymentMethods: ['check', 'ach'],
      remitTo: null,
    },
    notifications: { quietHours: null, replyToEmail: null },
    onboarding: { completedSteps: ['company'], currentStep: 'products' },
  };
}
