import { z } from 'zod';

const id = z.uuid();
const dateTime = z.iso.datetime({ offset: true });
const channel = z.enum(['call', 'email', 'meeting']);
const outcome = z.enum(['attempted', 'contacted', 'follow_up_requested', 'no_further_contact']);
const title = z.string().trim().min(1).max(160);
const revision = z.number().int().positive();

export const LogEnterpriseSalesInteraction = z
  .strictObject({
    channel,
    occurredAt: dateTime,
    outcome,
    notes: z.string().trim().min(1).max(4000),
    nextAt: dateTime.optional(),
    conversationId: id.optional(),
    newConversationTitle: title.optional(),
    clientRequestId: id,
  })
  .superRefine((value, context) => {
    if (value.nextAt && Date.parse(value.nextAt) <= Date.parse(value.occurredAt))
      context.addIssue({
        code: 'custom',
        path: ['nextAt'],
        message: 'Follow-up must be after the interaction.',
      });
    if (value.conversationId && value.newConversationTitle)
      context.addIssue({
        code: 'custom',
        path: ['conversationId'],
        message: 'Choose an existing conversation or start a new one.',
      });
  });

export const SalesInteractionConversation = z.object({ id, title });
export const SalesInteraction = z.object({
  id,
  channel,
  occurredAt: dateTime,
  outcome,
  notes: z.string(),
  linkedConversation: SalesInteractionConversation.nullable(),
  followUp: z.object({ id, dueAt: dateTime, reminderScheduled: z.boolean() }).nullable(),
});
export const SalesInteractionView = z.object({
  leadId: id,
  name: z.string(),
  revision,
  items: z.array(SalesInteraction),
  conversations: z.array(SalesInteractionConversation),
  nextCursor: z.string().nullable(),
});
export const SalesInteractionReceipt = z.object({ interaction: SalesInteraction, revision });

export const SetSalesFollowUpPolicy = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: id,
});
export const SalesFollowUpPolicy = z.object({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  history: z.array(
    z.object({ enabled: z.boolean(), reason: z.string(), revision, recordedAt: dateTime }),
  ),
});
