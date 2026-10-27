import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NotificationsView } from '../../../../features/settings/NotificationsView';

export const metadata: Metadata = { title: 'Notification preferences' };

export default function Page() {
  return (
    <Suspense>
      <NotificationsView />
    </Suspense>
  );
}
