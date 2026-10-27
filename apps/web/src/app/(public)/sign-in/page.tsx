import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignInView } from '../../../features/auth/SignInView';

export const metadata: Metadata = { title: 'Sign in' };

export default function Page() {
  return (
    <Suspense>
      <SignInView />
    </Suspense>
  );
}
