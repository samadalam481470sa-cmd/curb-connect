import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessView } from '../../../features/auth/AccessView';

export const metadata: Metadata = { title: 'Access' };

export default function Page() {
  return (
    <Suspense>
      <AccessView />
    </Suspense>
  );
}
