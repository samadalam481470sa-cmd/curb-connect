import { z } from 'zod';
import { EnterpriseScheduleDate } from './enterpriseSchedule';

export const EnterprisePendingProjectBidPage = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      packageId: z.uuid(),
      packageTitle: z.string(),
      vendorName: z.string(),
      amountMinor: z.number().int().safe().nonnegative(),
      validThrough: EnterpriseScheduleDate,
    }),
  ),
  nextCursor: z.string().nullable(),
});
