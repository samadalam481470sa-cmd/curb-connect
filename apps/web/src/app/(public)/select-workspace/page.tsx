import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SelectWorkspaceView } from '../../../features/auth/SelectWorkspaceView';

export const metadata: Metadata = { title: 'Choose a company' };

export default function Page() {
  return (
    <Suspense>
      <SelectWorkspaceView />
    </Suspense>
  );
}
