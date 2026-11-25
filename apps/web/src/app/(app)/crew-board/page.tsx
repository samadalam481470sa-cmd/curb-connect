import type { Metadata } from 'next';
import { CrewBoardView } from '../../../features/projectManagement/CrewBoardView';

export const metadata: Metadata = { title: 'Crew Board' };

export default function Page() {
  return <CrewBoardView />;
}
