import type { Metadata } from 'next';
import { HomeDashboard } from '../../features/home/HomeDashboard';

export const metadata: Metadata = { title: 'Home' };

export default function HomePage() {
  return <HomeDashboard />;
}
