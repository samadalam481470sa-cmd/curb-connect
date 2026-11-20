import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmailView } from '../../../features/auth/VerifyEmailView';

export const metadata: Metadata = { title: 'Confirm your email' };

export default function Page() {
  return (
    <Suspense>
      <VerifyEmailView />
    </Suspense>
  );
}
