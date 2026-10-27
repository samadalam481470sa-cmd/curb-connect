'use client';

import { useEffect } from 'react';

/**
 * Registers public/sw.js in production builds only, so local development never serves stale
 * assets from a worker. See docs/adr/0008 (PWA without a native app).
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((error: unknown) => console.warn('Service worker registration failed', error));
  }, []);
  return null;
}
