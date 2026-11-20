import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SubscriptionView } from '../../../features/subscription/SubscriptionView';

export const metadata: Metadata = { title: 'Subscription' };

export default function Page() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <SubscriptionView />
    </Suspense>
  );
}
