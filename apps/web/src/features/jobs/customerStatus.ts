// Shared pieces of the customer job-status feature: API response contracts, the stage list, and
// the share message used by the Copy / Text / Email buttons.
import { z } from 'zod';

export const CUSTOMER_STAGES = [
  { key: 'intake', label: 'Request received' },
  { key: 'estimating', label: 'Estimating' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in_progress', label: 'Work in progress' },
  { key: 'completed', label: 'Completed' },
] as const;
export type CustomerStageKey = (typeof CUSTOMER_STAGES)[number]['key'];

/** 0-based position of a stage in the progress bar; unknown stages count as the first. */
export function stageIndex(stage: string): number {
  const index = CUSTOMER_STAGES.findIndex((s) => s.key === stage);
  return index < 0 ? 0 : index;
}

const Stage = z.object({ key: z.string(), label: z.string() });
export const CustomerUpdateSchema = z.object({
  id: z.string(),
  stage: z.string(),
  stageLabel: z.string(),
  message: z.string(),
  createdAt: z.string(),
});
export type CustomerUpdate = z.infer<typeof CustomerUpdateSchema>;

export const CustomerLinkSchema = z.object({
  id: z.string(),
  recipientName: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  state: z.enum(['active', 'expired', 'revoked']),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  lastViewedAt: z.string().nullable(),
  viewCount: z.number(),
});
export type CustomerLink = z.infer<typeof CustomerLinkSchema>;

const JobSummary = z.object({
  id: z.string(),
  number: z.string(),
  title: z.string(),
  stage: z.string(),
  stageLabel: z.string(),
  status: z.string(),
});

export const CustomerStatusSchema = z.object({
  job: JobSummary,
  stages: z.array(Stage),
  updates: z.array(CustomerUpdateSchema),
  links: z.array(CustomerLinkSchema),
  emailEnabled: z.boolean(),
});
export type CustomerStatus = z.infer<typeof CustomerStatusSchema>;

export const PostUpdateResponseSchema = z.object({
  job: JobSummary,
  update: CustomerUpdateSchema,
  emailsQueued: z.number(),
});

export const CreateLinkResponseSchema = z.object({
  link: CustomerLinkSchema,
  url: z.string(),
  emailQueued: z.boolean(),
});

export const RevokeLinkResponseSchema = z.object({ link: CustomerLinkSchema });

/** What the customer's page receives from POST /v1/portal/job-status. */
export const PublicJobStatusSchema = z.object({
  company: z.object({ name: z.string() }),
  job: z.object({
    number: z.string(),
    title: z.string(),
    productLine: z.string(),
    stage: z.string(),
    stageLabel: z.string(),
    completed: z.boolean(),
    stageEnteredAt: z.string(),
    createdAt: z.string(),
  }),
  stages: z.array(Stage),
  updates: z.array(CustomerUpdateSchema),
  milestones: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        startsOn: z.string(),
        endsOn: z.string(),
        progressPercent: z.number(),
        status: z.string(),
      }),
    )
    .default([]),
  design: z
    .object({
      contract: z
        .object({
          id: z.string(),
          status: z.string(),
          planName: z.string().nullable(),
          basePriceMinor: z.number().nullable(),
          currency: z.string(),
        })
        .nullable(),
      selections: z.array(
        z.object({
          optionId: z.string(),
          name: z.string(),
          category: z.string(),
          priceMinor: z.number().nullable(),
          currency: z.string(),
        }),
      ),
      availableOptions: z.array(
        z.object({
          id: z.string(),
          category: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          priceMinor: z.number().nullable(),
          currency: z.string(),
        }),
      ),
      selectionsTotalMinor: z.number(),
    })
    .default({ contract: null, selections: [], availableOptions: [], selectionsTotalMinor: 0 }),
  /** The land house behind this job (community/lot/plan), when one is linked. */
  home: z
    .object({
      communityName: z.string(),
      lotNumber: z.string(),
      planName: z.string().nullable(),
      bedrooms: z.number().nullable(),
      bathrooms: z.number().nullable(),
      stories: z.number().nullable(),
      garage: z.string().nullable(),
      lengthFt: z.number().nullable(),
      widthFt: z.number().nullable(),
      roofPitch: z.number().nullable(),
    })
    .nullable()
    .default(null),
  recipientName: z.string().nullable(),
  expiresAt: z.string(),
});
export type PublicJobStatus = z.infer<typeof PublicJobStatusSchema>;
export type PublicDesign = PublicJobStatus['design'];
export const PortalSelectionsResponseSchema = z.object({ design: PublicJobStatusSchema.shape.design });

/** Reads the link token from a URL fragment (#t=...). Returns null when missing or malformed. */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('t');
  return token && /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : null;
}

export interface ShareMessageInput {
  url: string;
  jobTitle: string;
  companyName?: string | null;
  recipientName?: string | null;
}

export function shareMessage({
  url,
  jobTitle,
  companyName,
  recipientName,
}: ShareMessageInput): string {
  const hello = recipientName?.trim() ? `Hi ${recipientName.trim()}, ` : '';
  const from = companyName?.trim() ? `${companyName.trim()} here. ` : '';
  return `${hello}${from}You can follow the progress of "${jobTitle}" any time at this link: ${url}`;
}

/** sms: link that opens the phone's messaging app with the message filled in. */
export function smsHref(message: string): string {
  return `sms:?&body=${encodeURIComponent(message)}`;
}

export function mailtoHref(input: ShareMessageInput & { email?: string | null }): string {
  const subject = `Track your job: ${input.jobTitle}`;
  const to = input.email?.trim() ? encodeURIComponent(input.email.trim()) : '';
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareMessage(input))}`;
}
