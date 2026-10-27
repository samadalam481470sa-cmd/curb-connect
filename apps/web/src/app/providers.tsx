'use client';

import { ToastProvider } from '@fieldline/ui';
import type { ReactNode } from 'react';
import { OfflineIndicator } from '../components/pwa/OfflineIndicator';
import { ServiceWorkerManager } from '../components/pwa/ServiceWorkerManager';
import { AppProviders } from '../lib/session';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <ToastProvider>
        <OfflineIndicator />
        {children}
        <ServiceWorkerManager />
      </ToastProvider>
    </AppProviders>
  );
}
