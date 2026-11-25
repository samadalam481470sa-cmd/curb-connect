import { z } from 'zod';

export const EnterprisePunchStatus = z.enum(['open', 'in_progress', 'ready_for_review', 'closed']);
export type EnterprisePunchStatus = z.infer<typeof EnterprisePunchStatus>;

export const ENTERPRISE_PUNCH_TRANSITIONS = {
  open: ['in_progress'],
  in_progress: ['ready_for_review'],
  ready_for_review: ['in_progress', 'closed'],
  closed: [],
} as const satisfies Record<EnterprisePunchStatus, readonly EnterprisePunchStatus[]>;

export const CreateEnterprisePunchItem = z.object({
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().min(3).max(4000),
  location: z.string().trim().min(1).max(255),
  dueDate: z.iso.date().optional(),
  clientRequestId: z.uuid(),
});

export const UpdateEnterprisePunchItem = z.object({
  status: EnterprisePunchStatus,
  reviewNote: z.string().trim().min(3).max(1000).optional(),
});

export const EnterprisePunchItem = CreateEnterprisePunchItem.omit({ clientRequestId: true }).extend(
  {
    id: z.uuid(),
    projectId: z.uuid(),
    dueDate: z.iso.date().nullable(),
    status: EnterprisePunchStatus,
    revision: z.number().int().positive(),
    reviewNote: z.string().nullable(),
  },
);

export const EnterprisePunchPage = z.object({
  items: z.array(EnterprisePunchItem),
  nextCursor: z.string().nullable(),
});
