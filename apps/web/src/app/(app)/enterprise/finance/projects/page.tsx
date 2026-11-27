import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { EnterpriseFinanceProjects } from '../../../../../features/enterprise/EnterpriseFinanceProjects';

export const metadata: Metadata = { title: 'Finance projects — Enterprise Suite' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const query = await searchParams;
  const project = UuidSchema.safeParse(query.projectId);
  return (
    <EnterpriseFinanceProjects
      initialProjectId={project.success ? project.data.toLowerCase() : ''}
    />
  );
}
