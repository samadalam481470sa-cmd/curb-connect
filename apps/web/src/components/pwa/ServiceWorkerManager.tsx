'use client';

import { BRAND } from '@fieldline/contracts';
import { Button } from '@fieldline/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * Registers public/sw.js (production builds only, so development never serves stale assets) and
 * shows an update prompt when a new version is waiting. The new worker activates only when the
 * person chooses to reload, so an in-progress form is never swapped out underneath them.
 * See docs/adr/0008.
 */
export function ServiceWorkerManager({
  enabled = process.env.NODE_ENV === 'production',
}: {
  enabled?: boolean;
}) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const container = navigator.serviceWorker;
    let registration: ServiceWorkerRegistration | undefined;

    const watch = (reg: ServiceWorkerRegistration) => {
      // A waiting worker only matters if a previous version already controls the page.
      if (reg.waiting && container.controller) setWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && container.controller) setWaiting(installing);
        });
      });
    };

    const onControllerChange = () => {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };
    container.addEventListener('controllerchange', onControllerChange);

    container
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        watch(reg);
      })
      .catch((error: unknown) => console.warn('Service worker registration failed', error));

    // Check for a new version when the app returns to the foreground.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      container.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  if (!waiting) return null;
  return (
    <div className="web-update" role="status" aria-live="polite">
      <p>A new version of {BRAND.name} is ready.</p>
      <Button size="sm" onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}>
        Reload to update
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setWaiting(null)}>
        Later
      </Button>
    </div>
  );
}
