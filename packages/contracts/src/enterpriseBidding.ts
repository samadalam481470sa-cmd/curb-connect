import { z } from 'zod';
import { EnterpriseScheduleDate } from './enterpriseSchedule';

export const EnterpriseBidPackageInput = z.object({
  title: z.string().trim().min(2).max(180),
  scope: z.string().trim().min(3).max(8000),
  dueOn: EnterpriseScheduleDate,
  clientRequestId: z.uuid(),
});
export const EnterpriseBidQuoteInput = z.object({
  vendorName: z.string().trim().min(2).max(180),
  amountMinor: z.number().int().min(1).max(1_000_000_000_000),
  leadDays: z.number().int().min(0).max(3650),
  validThrough: EnterpriseScheduleDate,
  qualifications: z.string().trim().max(4000),
  clientRequestId: z.uuid(),
});

export const EnterpriseBidPackage = EnterpriseBidPackageInput.omit({
  clientRequestId: true,
}).extend({
  id: z.uuid(),
  revision: z.number().int().positive(),
  status: z.enum(['collecting', 'awarded', 'closed']),
  awardedQuoteId: z.uuid().nullable(),
  decisionNote: z.string().nullable(),
});
export type EnterpriseBidPackage = z.infer<typeof EnterpriseBidPackage>;

export const EnterpriseBidQuote = EnterpriseBidQuoteInput.omit({ clientRequestId: true }).extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type EnterpriseBidQuote = z.infer<typeof EnterpriseBidQuote>;
export const EnterpriseBidPackagePage = z.object({
  items: z.array(EnterpriseBidPackage),
  nextCursor: z.string().nullable(),
});
export const enterpriseBidReviewCriteria = ['scope', 'schedule', 'qualifications'] as const;

const EnterpriseBidReviewFields = z.object({
  outcome: z.enum(['responsive', 'nonresponsive']),
  checklist: z
    .array(
      z
        .object({
          criterion: z.enum(enterpriseBidReviewCriteria),
          result: z.enum(['meets', 'does_not_meet']),
          evidence: z.string().trim().min(3).max(500),
        })
        .strict(),
    )
    .length(enterpriseBidReviewCriteria.length),
  rationale: z.string().trim().min(3).max(1000),
  exceptionNote: z.string().trim().min(3).max(1000).nullable(),
});

export const EnterpriseBidReviewInput = EnterpriseBidReviewFields.extend({
  clientRequestId: z.uuid(),
})
  .strict()
  .superRefine((review, ctx) => {
    if (
      new Set(review.checklist.map(({ criterion }) => criterion)).size !==
      enterpriseBidReviewCriteria.length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['checklist'],
        message: 'Evaluate every criterion once.',
      });
    }
    const requiresException =
      review.outcome === 'responsive' &&
      review.checklist.some(({ result }) => result === 'does_not_meet');
    if (requiresException && !review.exceptionNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['exceptionNote'],
        message:
          'Document an exception for the unmet requirements before marking this quote responsive.',
      });
    }
    if (!requiresException && review.exceptionNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['exceptionNote'],
        message: 'An exception applies only when accepting a quote with unmet requirements.',
      });
    }
  });

export const EnterpriseBidReview = EnterpriseBidReviewFields.extend({
  id: z.uuid(),
  quoteId: z.uuid(),
  packageRevision: z.number().int().positive(),
  reviewedAt: z.iso.datetime(),
});
export type EnterpriseBidReview = z.infer<typeof EnterpriseBidReview>;

export const EnterpriseBidCollection = z.object({
  package: EnterpriseBidPackage,
  quotes: z.array(EnterpriseBidQuote),
  reviews: z.array(EnterpriseBidReview).default([]),
});
