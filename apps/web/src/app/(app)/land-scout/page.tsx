import type { Metadata } from 'next';
import { LandScoutView } from '../../../features/landScout/LandScoutView';

export const metadata: Metadata = { title: 'Land Scout' };

export default function Page() {
  return <LandScoutView />;
}
