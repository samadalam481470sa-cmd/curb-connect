import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignUpView } from '../../../features/auth/SignUpView';

export const metadata: Metadata = { title: 'Create account' };

export default function Page() {
  return (
    <Suspense>
      <SignUpView />
    </Suspense>
  );
}
