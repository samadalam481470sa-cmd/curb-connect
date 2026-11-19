import type { Metadata } from 'next';
import { HomeProjectsView } from '../../../../features/build/HomeProjectsView';

export const metadata: Metadata = { title: 'Home projects' };

export default function Page() {
  return <HomeProjectsView />;
}
