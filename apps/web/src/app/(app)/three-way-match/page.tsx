import type { Metadata } from 'next';
import { ThreeWayMatchView } from '../../../features/threeWayMatch/ThreeWayMatchView';

export const metadata: Metadata = { title: 'Three-Way Match' };

export default function Page() {
  return <ThreeWayMatchView />;
}
