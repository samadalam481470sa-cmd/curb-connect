import type { Metadata } from 'next';
import { ProjectManagementView } from '../../../features/projectManagement/ProjectManagementView';

export const metadata: Metadata = { title: 'Project Management' };

export default function Page() {
  return <ProjectManagementView />;
}
