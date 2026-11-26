import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { EnterpriseWipReports } from '../../../../../features/enterprise/EnterpriseWipReports';

export const metadata: Metadata = { title: 'Work in progress — Enterprise Suite' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const query = await searchParams;
  const project = UuidSchema.safeParse(query.projectId);
  return (
    <EnterpriseWipReports initialProjectId={project.success ? project.data.toLowerCase() : ''} />
  );
}
