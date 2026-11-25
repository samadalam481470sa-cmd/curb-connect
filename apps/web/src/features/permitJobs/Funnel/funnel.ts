// Active Permits Funnel — client helpers and response shapes.
// Pure functions live here so they can be unit-tested without rendering.
import { z } from 'zod';

export const FUNNEL_STAGES = ['new', 'contacted', 'quoted', 'interested', 'won', 'lost'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_STAGE_LABEL: Record<FunnelStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  interested: 'Interested',
  won: 'Won',
  lost: 'Lost',
};

/** Legal next stages from each stage (mirrors the API machine). */
export const FUNNEL_NEXT_STAGES: Record<FunnelStage, FunnelStage[]> = {
  new: ['contacted', 'lost'],
  contacted: ['quoted', 'interested', 'lost'],
  quoted: ['interested', 'won', 'lost'],
  interested: ['quoted', 'won', 'lost'],
  won: [],
  lost: ['new'],
};

export type CallPriority = 'hot' | 'warm' | 'cool';
export const CALL_PRIORITY_LABEL: Record<CallPriority, string> = {
  hot: 'Call now',
  warm: 'Call this week',
  cool: 'Follow up later',
};

export const CALL_OUTCOMES = ['answered', 'voicemail', 'no_answer', 'wrong_number', 'not_interested'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  answered: 'Answered',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  wrong_number: 'Wrong number',
  not_interested: 'Not interested',
};

/** tel: link from a published phone number. Null when no phone is known — the UI then
 *  shows "Phone not in public records" instead of a dead link. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `tel:+1${digits.slice(-10)}`;
}

export function freshnessLabel(
  freshness: 'live' | 'stale' | 'unavailable' | 'unknown',
): string {
  switch (freshness) {
    case 'live':
      return 'Live';
    case 'stale':
      return 'Stale — feed stopped publishing';
    case 'unavailable':
      return 'Feed did not answer';
    case 'unknown':
      return 'Not checked yet';
  }
}

export function formatUsd(value: number): string {
  return value > 0 ? `$${value.toLocaleString('en-US')}` : 'Value not published';
}

const FunnelLeadSchema = z.object({
  key: z.string(),
  source: z.string(),
  sourceName: z.string(),
  permitNumber: z.string(),
  city: z.string(),
  address: z.string(),
  zip: z.string(),
  description: z.string(),
  permitType: z.string(),
  workClass: z.string(),
  status: z.string(),
  issuedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  daysSince: z.number().nullable(),
  value: z.number(),
  units: z.number(),
  contractor: z.string(),
  projectType: z.string(),
  trades: z.array(z.string()),
  priority: z.enum(['hot', 'warm', 'cool']),
  callReasons: z.array(z.string()),
  freshness: z.enum(['live', 'stale', 'unavailable', 'unknown']),
  owner: z.object({
    name: z.string().nullable(),
    mailingAddress: z.string().nullable(),
    source: z.enum(['cad', 'permit']).nullable(),
    vintage: z.string().nullable(),
  }),
  contact: z.object({
    phone: z.string().nullable(),
    phoneSource: z.enum(['permit', 'contacts']).nullable(),
  }),
  decisionMaker: z.object({
    name: z.string().nullable(),
    source: z.enum(['tdlr', 'contacts']).nullable(),
    licenseType: z.string().nullable(),
    licenseNumber: z.string().nullable(),
    licenseExpiresOn: z.string().nullable(),
    phone: z.string().nullable(),
    phoneSource: z.enum(['tdlr', 'contacts']).nullable(),
    email: z.string().nullable(),
    role: z.string().nullable(),
  }),
  stage: z.string(),
  url: z.string(),
});

export const FunnelResultSchema = z.object({
  fetchedAt: z.string(),
  window: z.object({ since: z.string(), days: z.number() }),
  summary: z.object({
    permitsScanned: z.number(),
    leads: z.number(),
    hot: z.number(),
    warm: z.number(),
    cool: z.number(),
    excluded: z.object({ dead: z.number(), publicOwner: z.number(), duplicate: z.number() }),
  }),
  feeds: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['ok', 'unavailable']),
      count: z.number(),
      leads: z.number(),
      latest: z.string().nullable(),
      freshness: z.enum(['live', 'stale', 'unavailable', 'unknown']),
      lastCheckedAt: z.string(),
      message: z.string(),
    }),
  ),
  leads: z.array(FunnelLeadSchema),
  caveats: z.array(z.string()),
});

export type FunnelResult = z.infer<typeof FunnelResultSchema>;
export type FunnelLead = z.infer<typeof FunnelLeadSchema>;

export const FunnelCadenceSchema = z.object({
  checkedAt: z.string(),
  keepAliveMinutes: z.number(),
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      intervalMinutes: z.number(),
      due: z.boolean(),
      nextRefreshAt: z.string().nullable(),
      lastCheckedAt: z.string().nullable(),
      lastCheckedText: z.string(),
      note: z.string(),
    }),
  ),
});
export type FunnelCadence = z.infer<typeof FunnelCadenceSchema>;
