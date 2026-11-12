import type { Metadata } from 'next';
import { EnterpriseLanding } from '../../../features/enterprise/ProjectControlsView';

export const metadata: Metadata = { title: 'Commercial project controls' };

export default function Page() {
  return <EnterpriseLanding />;
}
