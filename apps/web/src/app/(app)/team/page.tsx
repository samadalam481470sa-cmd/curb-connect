import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TeamView } from '../../../features/team/TeamView';

export const metadata: Metadata = { title: 'Team' };

export default function Page() {
  return (
    <Suspense>
      <TeamView />
    </Suspense>
  );
}
