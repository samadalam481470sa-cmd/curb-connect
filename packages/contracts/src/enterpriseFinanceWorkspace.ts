import { z } from 'zod';
import { CurrencyCodeSchema } from './common';
import { EnterpriseScheduleDate } from './enterpriseSchedule';

const id = z.uuid();
const revision = z.number().int().positive();
const instant = z.iso.datetime();
const amount = z.string().regex(/^\d+$/);

export const EnterpriseFinanceProject = z.object({
  id,
  name: z.string(),
  budget: z
    .object({
      id,
      currency: CurrencyCodeSchema,
      state: z.enum(['draft', 'approved']),
      version: revision,
    })
    .nullable(),
  forecast: z
    .object({
      id,
      asOf: EnterpriseScheduleDate,
      status: z.enum(['incomplete', 'complete']),
      eacMinor: amount.nullable(),
      currency: CurrencyCodeSchema,
    })
    .nullable(),
});

export const EnterpriseFinanceProjectPage = z.object({
  items: z.array(EnterpriseFinanceProject),
  nextCursor: z.string().nullable(),
});

export const EnterpriseFinanceActivityKind = z.enum([
  'baseline_approved',
  'revision_requested',
  'revision_approved',
  'revision_rejected',
  'purchase_committed',
  'variance_requested',
  'variance_decided',
  'bill_posted',
  'forecast_saved',
  'scenario_saved',
]);

export const EnterpriseFinanceProjectActivity = z.object({
  projectId: id,
  projectName: z.string(),
  activity: z.array(
    z.object({
      recordId: id,
      kind: EnterpriseFinanceActivityKind,
      recordedAt: instant,
      orderId: id.nullable(),
    }),
  ),
  currentVariances: z.array(
    z.object({
      id,
      orderId: id,
      overrunMinor: amount,
      budgetVersion: revision,
      orderRevision: revision,
      canDecide: z.boolean(),
    }),
  ),
});
