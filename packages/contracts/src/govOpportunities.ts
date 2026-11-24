// Gov Opportunities: the finder that finds .gov listing opportunities FOR the contractor and
// tells them — the contractor does no researching. From the @many.talks.biz reel
// (DgIMBzhx90H): (1) dead links on city/state .gov "helpful links" resource pages, where the
// contractor can offer their own page as the replacement; (2) a free SAM.gov small-business
// profile; (3) the Texas CMBL supplier portal. Nothing here sends email or submits anything:
// opportunities are surfaced in-app, and the contractor decides what to do with them.
//
// Honesty rules (enforced in code, not just docs): a link is "dead" only when an actual HTTP
// check returned 4xx/5xx or the host no longer resolves; a check that timed out or errored
// another way is "unknown", never dead. A listing is "listed" only when the official API
// returned the company; without a SAM.gov key the SAM check reports "requires_setup", and
// CMBL has no public API, so it is always an honest "check manually" item with the exact
// search URL and steps — never a fabricated result.
import { z } from 'zod';

export const GovLinkStatusSchema = z.enum(['live', 'dead', 'unknown']);
export type GovLinkStatus = z.infer<typeof GovLinkStatusSchema>;

export const GovSeedPageSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  url: z.url(),
  /** When this page URL was last verified to load (ISO date), so a stale seed is visible. */
  verifiedAt: z.string(),
});
export type GovSeedPage = z.infer<typeof GovSeedPageSchema>;

export const GovOpportunitySchema = z.object({
  pageId: z.string(),
  pageName: z.string(),
  pageCity: z.string(),
  pageUrl: z.url(),
  deadUrl: z.string(),
  linkText: z.string(),
  trade: z.string(),
  /** 'strong' = the dead link's text or URL names the contractor's trade; 'general' = a dead
   *  link on a resource page in the contractor's city, trade not named. */
  match: z.enum(['strong', 'general']),
  /** Plain-language suggestion of what the contractor could offer as the replacement page,
   *  built from their trade and the page — never invented page content. */
  whatToOffer: z.string(),
  httpStatus: z.number().int().nullable(),
  checkedAt: z.string(),
});
export type GovOpportunity = z.infer<typeof GovOpportunitySchema>;

export const GovListingSchema = z.object({
  id: z.enum(['sam', 'cmbl']),
  name: z.string(),
  status: z.enum(['listed', 'not_listed', 'requires_setup', 'manual_check', 'unknown']),
  detail: z.string(),
  url: z.url(),
  /** Only for manual checks: the exact steps to look the company up, from the official FAQ. */
  steps: z.array(z.string()).optional(),
  checkedAt: z.string().nullable(),
});
export type GovListing = z.infer<typeof GovListingSchema>;

export const GovOpportunitiesResponseSchema = z.object({
  trade: z.string(),
  company: z.string(),
  opportunities: z.array(GovOpportunitySchema),
  listings: z.array(GovListingSchema),
  /** Newest check across the stored link rows, or null before the first scan. */
  lastCheckedAt: z.string().nullable(),
  /** Email alerts stay off until email is connected — the app tells the contractor here. */
  emailNote: z.string(),
  aiConfigured: z.boolean(),
});
export type GovOpportunitiesResponse = z.infer<typeof GovOpportunitiesResponseSchema>;

export const GovPageStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  url: z.url(),
  lastCheckedAt: z.string().nullable(),
  linksChecked: z.number().int(),
  deadLinks: z.number().int(),
  liveLinks: z.number().int(),
  unknownLinks: z.number().int(),
});
export type GovPageStatus = z.infer<typeof GovPageStatusSchema>;

export const GovStatusResponseSchema = z.object({
  samKeyConfigured: z.boolean(),
  pages: z.array(GovPageStatusSchema),
  lastCheckedAt: z.string().nullable(),
  emailNote: z.string(),
});
export type GovStatusResponse = z.infer<typeof GovStatusResponseSchema>;

export const GovRefreshResponseSchema = z.object({
  pagesChecked: z.number().int(),
  linksChecked: z.number().int(),
  deadFound: z.number().int(),
  unknownCount: z.number().int(),
  checkedAt: z.string(),
});
export type GovRefreshResponse = z.infer<typeof GovRefreshResponseSchema>;

export const GovDraftRequestSchema = z.object({
  pageName: z.string().trim().min(1).max(200),
  pageUrl: z.url(),
  deadUrl: z.string().trim().min(1).max(2000),
  linkText: z.string().trim().max(300).default(''),
  trade: z.string().trim().min(1).max(40),
  company: z.string().trim().min(1).max(120),
  yourName: z.string().trim().max(80).default(''),
  website: z.union([z.url(), z.literal('')]).default(''),
});
export type GovDraftRequest = z.infer<typeof GovDraftRequestSchema>;

export const GovDraftResponseSchema = z.object({
  draft: z.string(),
  model: z.string(),
  source: z.enum(['home', 'open']),
});
export type GovDraftResponse = z.infer<typeof GovDraftResponseSchema>;
