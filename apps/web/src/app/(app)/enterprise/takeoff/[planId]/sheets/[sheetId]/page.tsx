import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TakeoffSheetRoute } from '../../../../../../../features/enterprise/TakeoffSheetRoute';

export const metadata: Metadata = { title: 'Plan sheet — Enterprise Suite' };

export default async function Page({
  params,
}: {
  params: Promise<{ planId: string; sheetId: string }>;
}) {
  const { planId, sheetId } = await params;
  if (!UuidSchema.safeParse(planId).success || !UuidSchema.safeParse(sheetId).success) notFound();
  return <TakeoffSheetRoute planId={planId.toLowerCase()} sheetId={sheetId.toLowerCase()} />;
}
