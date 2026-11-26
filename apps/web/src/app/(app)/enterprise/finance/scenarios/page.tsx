import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { EnterpriseFinanceScenarios } from '../../../../../features/enterprise/EnterpriseFinanceScenarios';

export const metadata: Metadata = { title: 'Cost scenarios — Enterprise Suite' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const query = await searchParams;
  const project = UuidSchema.safeParse(query.projectId);
  return (
    <EnterpriseFinanceScenarios projectId={project.success ? project.data.toLowerCase() : ''} />
  );
}
